#!/usr/bin/env python3
"""Send one local, deduplicated alert for exceptional handoff transitions.

The notifier is intentionally dependency-free. Configuration and delivery state
live outside Git by default under ``mistral-lokaal/secure``.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import smtplib
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from email.message import EmailMessage
from pathlib import Path
from typing import Callable, Mapping

from lint_handoff import HandoffValidationError, parse_frontmatter
from autorun_io import AutorunIOError, append_activity


REPO = Path(__file__).resolve().parents[1]
DEFAULT_HANDOFF = REPO / "handoff.md"
DEFAULT_CONFIG = REPO / "mistral-lokaal" / "secure" / "notifier.env"
DEFAULT_STATE = REPO / "mistral-lokaal" / "secure" / "notifier-state.json"
DEFAULT_ACTIVITY_LOG = REPO / "autorun.log"
TRIGGER_STATES = {"BLOCKED", "SPRINT_DONE"}
REQUIRED_HANDOFF_KEYS = {"state", "since", "action_required_by", "note"}
ALLOWED_CHANNELS = {"email", "ntfy"}


class NotifierError(RuntimeError):
    """Raised when a safe notification cannot be prepared or delivered."""


@dataclass(frozen=True)
class Notification:
    state: str
    since: str
    note: str
    action: str
    subject: str
    body: str


@dataclass(frozen=True)
class NotifyResult:
    triggered: bool
    sent_channels: tuple[str, ...] = ()
    duplicate: bool = False


Sender = Callable[[Mapping[str, str], Notification], None]


def append_notifier_activity(state: str, outcome: str, path: Path = DEFAULT_ACTIVITY_LOG) -> None:
    try:
        safe_state = state or "ONBEKEND"
        append_activity("notifier", safe_state, safe_state, outcome, log_path=path)
    except AutorunIOError:
        # Observability must never turn a successfully sent alert into a retry storm.
        pass


def read_handoff(path: Path) -> dict[str, str]:
    try:
        values = parse_frontmatter(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, HandoffValidationError) as exc:
        raise NotifierError(f"kan handoff niet veilig lezen: {exc}") from exc

    missing = sorted(REQUIRED_HANDOFF_KEYS - values.keys())
    if missing:
        raise NotifierError(f"handoff mist sleutel(s): {', '.join(missing)}")
    if not values["state"] or not values["since"]:
        raise NotifierError("handoff state en since mogen niet leeg zijn")
    return values


def parse_env_file(path: Path) -> dict[str, str]:
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except (OSError, UnicodeError) as exc:
        raise NotifierError(f"kan lokale notifierconfig niet lezen: {path}") from exc

    config: dict[str, str] = {}
    for line_number, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise NotifierError(f"ongeldige configregel {line_number}: verwacht NAAM=WAARDE")
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or not key.replace("_", "").isalnum() or key.upper() != key:
            raise NotifierError(f"ongeldige confignaam op regel {line_number}")
        if key in config:
            raise NotifierError(f"dubbele confignaam: {key}")
        value = _parse_env_value(value, line_number)
        config[key] = value
    return config


def _parse_env_value(value: str, line_number: int) -> str:
    if value[:1] in {'"', "'"}:
        quote = value[0]
        closing = value.find(quote, 1)
        if closing < 0:
            raise NotifierError(f"niet-afgesloten quote op configregel {line_number}")
        remainder = value[closing + 1 :].strip()
        if remainder and not remainder.startswith("#"):
            raise NotifierError(f"onverwachte tekst na quote op configregel {line_number}")
        value = value[1:closing]
    else:
        if value[-1:] in {'"', "'"}:
            raise NotifierError(f"onverwachte afsluitende quote op configregel {line_number}")
        for index, character in enumerate(value):
            if character == "#" and index > 0 and value[index - 1].isspace():
                value = value[:index].rstrip()
                break
    if "\x00" in value:
        raise NotifierError(f"NUL-teken in configwaarde op regel {line_number}")
    return value


def configured_channels(config: Mapping[str, str]) -> tuple[str, ...]:
    raw = config.get("NOTIFIER_CHANNELS", "email")
    channels = tuple(dict.fromkeys(part.strip().lower() for part in raw.split(",") if part.strip()))
    if not channels:
        raise NotifierError("NOTIFIER_CHANNELS bevat geen kanaal")
    unknown = sorted(set(channels) - ALLOWED_CHANNELS)
    if unknown:
        raise NotifierError(f"onbekend notifierkanaal: {', '.join(unknown)}")
    return channels


def notification_for(values: Mapping[str, str], action_url: str = "") -> Notification | None:
    state = values["state"]
    action_required_by = values["action_required_by"].lower()
    if state not in TRIGGER_STATES and action_required_by != "bas":
        return None

    note = values["note"].strip() or "Geen aanvullende toelichting."
    note_lower = note.lower()
    if state == "BLOCKED":
        action = "Open handoff.md en behandel de blokkade."
    elif action_required_by == "bas" and "productie" in note_lower:
        action = "Open GitHub Actions en keur de productie-deploy goed."
    elif action_required_by == "bas" and "acceptatie" in note_lower and "deploy" in note_lower:
        action = "Open GitHub Actions en start Deploy acceptatie."
    elif action_required_by == "bas":
        action = "Open handoff.md en voer de gevraagde actie uit."
    else:
        action = "Bekijk progress.md en geef de go/no-go voor de volgende sprint."

    if action_url:
        action = f"{action} {action_url}"

    subject = f"[ALV Digitaal] Actie nodig: {state}"
    body = f"Status: {state}\nSinds: {values['since']}\n\n{note}\n\nActie: {action}\n"
    return Notification(state, values["since"], note, action, subject, body)


def _require(config: Mapping[str, str], *keys: str) -> tuple[str, ...]:
    missing = [key for key in keys if not config.get(key)]
    if missing:
        raise NotifierError(f"config mist verplichte sleutel(s): {', '.join(missing)}")
    return tuple(config[key] for key in keys)


def send_email(config: Mapping[str, str], notification: Notification) -> None:
    host, sender, recipient = _require(config, "SMTP_HOST", "SMTP_FROM", "SMTP_TO")
    try:
        port = int(config.get("SMTP_PORT", "587"))
    except ValueError as exc:
        raise NotifierError("SMTP_PORT moet numeriek zijn") from exc
    if not 1 <= port <= 65535:
        raise NotifierError("SMTP_PORT valt buiten 1..65535")

    security = config.get("SMTP_SECURITY", "starttls").lower()
    if security not in {"ssl", "starttls"}:
        raise NotifierError("SMTP_SECURITY moet ssl of starttls zijn")
    username = config.get("SMTP_USERNAME", "")
    password = config.get("SMTP_PASSWORD", "")
    if bool(username) != bool(password):
        raise NotifierError("SMTP_USERNAME en SMTP_PASSWORD moeten samen zijn ingesteld")

    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = notification.subject
    message.set_content(notification.body)

    context = ssl.create_default_context()
    try:
        if security == "ssl":
            with smtplib.SMTP_SSL(host, port, timeout=20, context=context) as client:
                if username:
                    client.login(username, password)
                client.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=20) as client:
                client.ehlo()
                client.starttls(context=context)
                client.ehlo()
                if username:
                    client.login(username, password)
                client.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        raise NotifierError("e-mailmelding kon niet worden afgeleverd") from exc


def send_ntfy(config: Mapping[str, str], notification: Notification) -> None:
    base_url, topic = _require(config, "NTFY_URL", "NTFY_TOPIC")
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise NotifierError("NTFY_URL moet een HTTPS-URL zonder ingebouwde credentials zijn")
    endpoint = f"{base_url.rstrip('/')}/{urllib.parse.quote(topic, safe='')}"
    headers = {
        "Content-Type": "text/plain; charset=utf-8",
        "Title": notification.subject,
        "Priority": "high",
        "Tags": "warning",
    }
    token = config.get("NTFY_TOKEN", "")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        endpoint,
        data=notification.body.encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            if not 200 <= response.status < 300:
                raise NotifierError(f"pushmelding gaf HTTP {response.status}")
    except (OSError, urllib.error.URLError) as exc:
        raise NotifierError("pushmelding kon niet worden afgeleverd") from exc


def load_delivery_state(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise NotifierError("lokaal notifier-statebestand is ongeldig; niet verzonden om spam te voorkomen") from exc
    if not isinstance(value, dict):
        raise NotifierError("lokaal notifier-statebestand moet een object bevatten")
    channels = value.get("sent_channels", [])
    if not isinstance(channels, list) or not all(isinstance(item, str) for item in channels):
        raise NotifierError("lokaal notifier-statebestand bevat ongeldige kanalen")
    return value


@contextlib.contextmanager
def delivery_lock(path: Path, *, timeout: float = 30.0, stale_after: float = 120.0):
    """Serialize load/send/save across watcher and hook processes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = Path(f"{path}.lock")
    deadline = time.monotonic() + timeout
    while True:
        try:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            try:
                age = time.time() - lock_path.stat().st_mtime
            except FileNotFoundError:
                continue
            if age > stale_after:
                try:
                    lock_path.unlink()
                except FileNotFoundError:
                    pass
                continue
            if time.monotonic() >= deadline:
                raise NotifierError("notifier-state is nog door een ander proces vergrendeld")
            time.sleep(0.05)
            continue
        except OSError as exc:
            raise NotifierError("notifier-state kon niet worden vergrendeld") from exc
        else:
            try:
                with os.fdopen(descriptor, "w", encoding="ascii") as handle:
                    handle.write(f"pid={os.getpid()}\n")
                os.chmod(lock_path, 0o600)
            except OSError:
                try:
                    os.close(descriptor)
                except OSError:
                    pass
                lock_path.unlink(missing_ok=True)
                raise NotifierError("notifier-lock kon niet veilig worden vastgelegd")
            break

    try:
        yield
    finally:
        try:
            lock_path.unlink(missing_ok=True)
        except OSError:
            pass


def save_delivery_state(path: Path, notification: Notification, sent_channels: set[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "state": notification.state,
        "since": notification.since,
        "sent_channels": sorted(sent_channels),
    }
    temp_name = ""
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False
        ) as handle:
            temp_name = handle.name
            json.dump(payload, handle, ensure_ascii=False, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_name, 0o600)
        os.replace(temp_name, path)
        os.chmod(path, 0o600)
    except OSError as exc:
        raise NotifierError("lokaal notifier-statebestand kon niet atomair worden opgeslagen") from exc
    finally:
        if temp_name:
            try:
                Path(temp_name).unlink(missing_ok=True)
            except OSError:
                pass


def notify_values(
    values: Mapping[str, str],
    config: Mapping[str, str],
    state_path: Path,
    *,
    senders: Mapping[str, Sender] | None = None,
    dry_run: bool = False,
) -> NotifyResult:
    notification = notification_for(values, config.get("NOTIFIER_ACTION_URL", ""))
    if notification is None:
        return NotifyResult(triggered=False)

    channels = configured_channels(config)
    with delivery_lock(state_path):
        state = load_delivery_state(state_path)
        same_transition = state.get("state") == notification.state and state.get("since") == notification.since
        sent = set(state.get("sent_channels", [])) if same_transition else set()
        pending = tuple(channel for channel in channels if channel not in sent)
        if not pending:
            return NotifyResult(triggered=True, duplicate=True)
        if dry_run:
            print(notification.subject)
            print(notification.body, end="")
            return NotifyResult(triggered=True)

        available_senders = senders or {"email": send_email, "ntfy": send_ntfy}
        delivered: list[str] = []
        for channel in pending:
            sender = available_senders.get(channel)
            if sender is None:
                raise NotifierError(f"geen afzender beschikbaar voor kanaal: {channel}")
            sender(config, notification)
            sent.add(channel)
            delivered.append(channel)
            # Persist per channel so a later channel failure cannot duplicate a success.
            save_delivery_state(state_path, notification, sent)
        return NotifyResult(triggered=True, sent_channels=tuple(delivered))


def notify_once(
    handoff_path: Path,
    config: Mapping[str, str],
    state_path: Path,
    *,
    senders: Mapping[str, Sender] | None = None,
    dry_run: bool = False,
) -> NotifyResult:
    return notify_values(
        read_handoff(handoff_path),
        config,
        state_path,
        senders=senders,
        dry_run=dry_run,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--handoff", type=Path, default=DEFAULT_HANDOFF)
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(os.environ.get("ALV_NOTIFIER_CONFIG", DEFAULT_CONFIG)),
        help="lokaal notifier.env-pad (of ALV_NOTIFIER_CONFIG)",
    )
    parser.add_argument(
        "--state-file",
        type=Path,
        default=Path(os.environ.get("ALV_NOTIFIER_STATE", DEFAULT_STATE)),
        help="lokaal deduplicatiestate-pad (of ALV_NOTIFIER_STATE)",
    )
    parser.add_argument("--dry-run", action="store_true", help="toon bericht zonder verzending of statewijziging")
    parser.add_argument("--activity-log", type=Path, default=DEFAULT_ACTIVITY_LOG)
    args = parser.parse_args(argv)

    values: dict[str, str] = {}
    try:
        values = read_handoff(args.handoff)
        if notification_for(values) is None:
            result = NotifyResult(triggered=False)
        else:
            result = notify_values(
                values,
                parse_env_file(args.config),
                args.state_file,
                dry_run=args.dry_run,
            )
    except NotifierError as exc:
        append_notifier_activity(values.get("state", "ONBEKEND"), "FOUT", args.activity_log)
        print(f"notifier: FOUT — {exc}", file=sys.stderr)
        return 1

    if not result.triggered:
        print("notifier: geen uitzonderingssituatie")
    elif result.duplicate:
        append_notifier_activity(values["state"], "DEDUP — niets verzonden", args.activity_log)
        print("notifier: overgang al gemeld")
    elif args.dry_run:
        append_notifier_activity(values["state"], "DRY-RUN — niets verzonden", args.activity_log)
        print("notifier: dry-run — niets verzonden of opgeslagen")
    else:
        append_notifier_activity(
            values["state"], f"VERZONDEN via {','.join(result.sent_channels)}", args.activity_log
        )
        print(f"notifier: verzonden via {', '.join(result.sent_channels)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
