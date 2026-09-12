#!/usr/bin/env python3
"""Synchronize pipeline coordination through an isolated, deterministic Git process.

The steward is deliberately limited to ``handoff.md`` and ``progress.md``.  It
clones ``main`` into a temporary directory, commits only those snapshots and
pushes that isolated checkout.  Product changes in the caller's worktree are
therefore never staged, committed or pushed by this script.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Mapping, Sequence

from lint_handoff import HandoffValidationError, parse_frontmatter, validate_file, validate_values
from check_coherence import CoherenceError, validate_coherence
from pipeline_guard import PipelineGuardError, load_sprint_metadata, verify_reserved_tag


COORDINATION_PATHS = ("handoff.md", "progress.md")
ACTIVATION_PATHS = (
    "config/pipeline-sprint.json",
    "sprint.md",
    "progress.md",
    "handoff.md",
)
DEFAULT_TOKEN_PATH = Path("mistral-lokaal/secure/git-steward.env")
ROLE_NAMES = {"codex": "Codex", "claude": "Claude", "gemini": "Gemini", "mistral": "Mistral"}
STEWARD_NAME = "ALV GitSteward"
STEWARD_EMAIL = "git-steward@localhost.invalid"
ALLOWED_TRANSITIONS = {
    "ARCHITECTUUR": {"READY_FOR_DEV", "BLOCKED"},
    "READY_FOR_DEV": {"DEV_IN_PROGRESS", "BLOCKED"},
    "DEV_IN_PROGRESS": {"READY_FOR_TEST", "BLOCKED"},
    "READY_FOR_TEST": {"TEST_IN_PROGRESS", "READY_FOR_VALIDATION", "BLOCKED"},
    "TEST_IN_PROGRESS": {"READY_FOR_VALIDATION", "BLOCKED"},
    "READY_FOR_VALIDATION": {"VALIDATION_IN_PROGRESS", "BLOCKED"},
    "VALIDATION_IN_PROGRESS": {"READY_FOR_INTEGRATION", "BLOCKED"},
    "READY_FOR_INTEGRATION": {"INTEGRATION_IN_PROGRESS", "BLOCKED"},
    "INTEGRATION_IN_PROGRESS": {"SPRINT_DONE", "BLOCKED"},
    "SPRINT_DONE": {"ARCHITECTUUR", "READY_FOR_DEV", "BLOCKED"},
}


class GitStewardError(RuntimeError):
    """A fail-closed steward error whose message is safe to print."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _single_line(value: str, *, maximum: int = 240) -> str:
    cleaned = " ".join(value.replace("\r", " ").replace("\n", " ").split())
    if not cleaned:
        raise GitStewardError("note mag niet leeg zijn")
    return cleaned[:maximum]


def _atomic_write(path: Path, content: str) -> None:
    temporary = ""
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=path.parent,
            prefix=f".{path.name}.",
            delete=False,
        ) as handle:
            temporary = handle.name
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary:
            Path(temporary).unlink(missing_ok=True)


def _render_handoff(text: str, values: Mapping[str, str]) -> str:
    lines = text.lstrip("\ufeff").splitlines()
    try:
        closing = next(index for index, line in enumerate(lines[1:], 1) if line.strip() == "---")
    except StopIteration as exc:
        raise GitStewardError("handoff-frontmatter heeft geen afsluiter") from exc
    note = values["note"].replace('"', "'")
    frontmatter = [
        "---",
        f"sprint: {values['sprint']}",
        f"state: {values['state']}",
        f"owner: {values['owner']}",
        f"since: {values['since']}",
        f"next: {values['next']}",
        f"action_required_by: {values['action_required_by']}",
        f"blocked: {values['blocked']}",
        f'note: "{note}"',
        "---",
    ]
    body = "\n".join(lines[closing + 1 :])
    return "\n".join(frontmatter) + "\n" + body + "\n"


def _read_token_file(path: Path) -> str:
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as exc:
        raise GitStewardError(f"kan tokenbestand niet lezen: {path}") from exc
    values: list[str] = []
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" in stripped:
            key, value = stripped.split("=", 1)
            if key.strip() not in {"GH_TOKEN", "GITHUB_TOKEN"}:
                continue
            stripped = value.strip().strip('"\'')
        values.append(stripped)
    if len(values) != 1 or not values[0]:
        raise GitStewardError("tokenbestand moet exact één GH_TOKEN bevatten")
    return values[0]


def load_gh_token(repo: Path, token_file: Path | None = None) -> str | None:
    """Load a token from the ignored secure directory, or the steward process env."""
    configured = token_file
    if configured is None and os.environ.get("ALV_GIT_STEWARD_TOKEN_FILE"):
        configured = Path(os.environ["ALV_GIT_STEWARD_TOKEN_FILE"])
    if configured is None:
        default = repo / DEFAULT_TOKEN_PATH
        configured = default if default.exists() else None
    if configured is not None:
        candidate = configured if configured.is_absolute() else repo / configured
        secure = (repo / "mistral-lokaal" / "secure").resolve()
        resolved = candidate.resolve()
        if resolved != secure and secure not in resolved.parents:
            raise GitStewardError("GH_TOKEN-bestand moet in mistral-lokaal/secure staan")
        return _read_token_file(resolved)
    return os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")


def _git_dir(repo: Path) -> Path:
    marker = repo / ".git"
    if marker.is_dir():
        return marker
    if marker.is_file():
        text = marker.read_text(encoding="utf-8").strip()
        if text.lower().startswith("gitdir:"):
            target = Path(text.split(":", 1)[1].strip())
            return target if target.is_absolute() else (repo / target).resolve()
    raise GitStewardError(f"geen geldige Git-worktree: {repo}")


def _system_has_live_git() -> bool:
    """Conservatively report a live Git process; detector errors prevent deletion."""
    try:
        if os.name == "nt":
            result = subprocess.run(
                ["tasklist", "/FI", "IMAGENAME eq git.exe", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                check=False,
            )
            return result.returncode != 0 or '"git.exe"' in result.stdout.lower()
        result = subprocess.run(["pgrep", "-x", "git"], capture_output=True, check=False)
        return result.returncode == 0
    except OSError:
        return True


def cleanup_stale_index_lock(
    repo: Path,
    *,
    stale_after_seconds: float,
    process_checker: Callable[[], bool] = _system_has_live_git,
    now: float | None = None,
) -> bool:
    """Remove only an old index.lock when no Git process is alive."""
    lock = _git_dir(repo) / "index.lock"
    if not lock.exists():
        return False
    age = (time.time() if now is None else now) - lock.stat().st_mtime
    if age < stale_after_seconds or process_checker():
        return False
    try:
        lock.unlink()
    except OSError as exc:
        raise GitStewardError("oude .git/index.lock kon niet veilig worden verwijderd") from exc
    return True


class GitSteward:
    def __init__(
        self,
        repo: Path,
        *,
        remote: str = "origin",
        branch: str = "main",
        token_file: Path | None = None,
        attempts: int = 3,
        backoff_seconds: float = 1.0,
        stale_lock_seconds: float = 120.0,
        sleeper: Callable[[float], None] = time.sleep,
        process_checker: Callable[[], bool] = _system_has_live_git,
    ) -> None:
        self.repo = repo.resolve()
        self.remote = remote
        self.branch = branch
        self.attempts = attempts
        self.backoff_seconds = backoff_seconds
        self.stale_lock_seconds = stale_lock_seconds
        self.sleeper = sleeper
        self.process_checker = process_checker
        if attempts < 1:
            raise GitStewardError("attempts moet minimaal 1 zijn")
        _git_dir(self.repo)
        self.token = load_gh_token(self.repo, token_file)

    def _redact(self, value: str) -> str:
        redacted = value.replace(self.token, "***") if self.token else value
        return re.sub(r"(https?://)[^/@\s]+@", r"\1***@", redacted)

    def _git_prefix(self) -> list[str]:
        prefix = ["git"]
        if self.token:
            prefix.extend(["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"])
        return prefix

    def _environment(self) -> dict[str, str]:
        environment = dict(os.environ)
        environment["GIT_TERMINAL_PROMPT"] = "0"
        environment["GIT_AUTHOR_NAME"] = STEWARD_NAME
        environment["GIT_AUTHOR_EMAIL"] = STEWARD_EMAIL
        environment["GIT_COMMITTER_NAME"] = STEWARD_NAME
        environment["GIT_COMMITTER_EMAIL"] = STEWARD_EMAIL
        if self.token:
            environment["GH_TOKEN"] = self.token
            environment.pop("GITHUB_TOKEN", None)
        return environment

    def _run_git(self, args: Sequence[str], *, cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
        command = [*self._git_prefix(), *args]
        try:
            result = subprocess.run(
                command,
                cwd=cwd,
                env=self._environment(),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
        except OSError as exc:
            raise GitStewardError(f"git kon niet starten: {self._redact(str(exc))}") from exc
        if check and result.returncode != 0:
            detail = (result.stderr or result.stdout or "onbekende git-fout").strip()
            raise GitStewardError(self._redact(detail))
        return result

    def _retry(self, label: str, operation: Callable[[], None], *, recovery: Callable[[], None] | None = None) -> None:
        last_error: GitStewardError | None = None
        for attempt in range(1, self.attempts + 1):
            try:
                operation()
                return
            except GitStewardError as exc:
                last_error = exc
                if attempt == self.attempts:
                    break
                if recovery is not None:
                    try:
                        recovery()
                    except GitStewardError as recovery_error:
                        raise GitStewardError(
                            f"{label}-herstel faalde gesloten: {recovery_error}"
                        ) from recovery_error
                self.sleeper(self.backoff_seconds * (2 ** (attempt - 1)))
        assert last_error is not None
        raise GitStewardError(f"{label} mislukt na {self.attempts} pogingen: {last_error}")

    def _cleanup_lock(self, repo: Path) -> None:
        cleanup_stale_index_lock(
            repo,
            stale_after_seconds=self.stale_lock_seconds,
            process_checker=self.process_checker,
        )

    def _remote_url(self) -> str:
        result = self._run_git(["remote", "get-url", self.remote], cwd=self.repo)
        url = result.stdout.strip()
        if not url:
            raise GitStewardError(f"remote {self.remote!r} heeft geen URL")
        if re.match(r"https://github\.com(?:/|$)", url, re.IGNORECASE) and not self.token:
            raise GitStewardError("GitHub HTTPS vereist GH_TOKEN in mistral-lokaal/secure")
        return url

    def _snapshots(self) -> dict[str, bytes]:
        snapshots: dict[str, bytes] = {}
        for relative in COORDINATION_PATHS:
            path = self.repo / relative
            if path.is_symlink() or not path.is_file():
                raise GitStewardError(f"coördinatiebestand ontbreekt of is onveilig: {relative}")
            snapshots[relative] = path.read_bytes()
        try:
            validate_file(self.repo / "handoff.md")
        except HandoffValidationError as exc:
            raise GitStewardError(f"ongeldige handoff; sync geweigerd: {exc}") from exc
        return snapshots

    def _clone_once(self, remote_url: str, destination: Path) -> None:
        if destination.exists():
            shutil.rmtree(destination)
        self._run_git(
            [
                "clone",
                "--quiet",
                "--origin",
                self.remote,
                "--single-branch",
                "--branch",
                self.branch,
                "--",
                remote_url,
                str(destination),
            ],
            cwd=destination.parent,
        )

    def _push_once(self, checkout: Path) -> None:
        self._cleanup_lock(checkout)
        self._run_git(["push", self.remote, f"HEAD:{self.branch}"], cwd=checkout)

    @staticmethod
    def _normalized(content: bytes) -> bytes:
        return content.replace(b"\r\n", b"\n").replace(b"\r", b"\n")

    def _blob(self, checkout: Path, revision: str, relative: str) -> bytes:
        result = subprocess.run(
            [*self._git_prefix(), "show", f"{revision}:{relative}"],
            cwd=checkout,
            env=self._environment(),
            capture_output=True,
            check=False,
        )
        if result.returncode:
            detail = result.stderr.decode("utf-8", "replace").strip()
            raise GitStewardError(
                f"broncoördinatie ontbreekt voor {revision}:{relative}: {self._redact(detail)}"
            )
        return self._normalized(result.stdout)

    def _source_snapshots(self, checkout: Path, source_sha: str) -> dict[str, bytes]:
        if not re.fullmatch(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})", source_sha):
            raise GitStewardError("source-SHA is ongeldig")
        return {
            relative: self._blob(checkout, source_sha, relative)
            for relative in COORDINATION_PATHS
        }

    @staticmethod
    def _frontmatter_from_bytes(content: bytes) -> dict[str, str]:
        try:
            values = parse_frontmatter(content.decode("utf-8-sig"))
            validate_values(values)
            return values
        except (UnicodeError, HandoffValidationError) as exc:
            raise GitStewardError(f"ongeldige handoff-snapshot: {exc}") from exc

    @staticmethod
    def _progress_delta(source: bytes, target: bytes) -> bytes:
        if not target.startswith(source):
            raise GitStewardError("progress.md mag tijdens een beurt uitsluitend worden aangevuld")
        return target[len(source):]

    def _decide_fresh_transition(
        self,
        checkout: Path,
        *,
        target: Mapping[str, bytes],
        source: Mapping[str, bytes],
        expected_from: str,
    ) -> dict[str, bytes]:
        source_values = self._frontmatter_from_bytes(source["handoff.md"])
        target_values = self._frontmatter_from_bytes(target["handoff.md"])
        current_handoff = self._normalized((checkout / "handoff.md").read_bytes())
        current_progress = self._normalized((checkout / "progress.md").read_bytes())
        current_values = self._frontmatter_from_bytes(current_handoff)

        if source_values["state"] != expected_from:
            raise GitStewardError(
                f"source-SHA bevat {source_values['state']}, niet expected-from {expected_from}"
            )
        target_state = target_values["state"]
        if target_state != expected_from and target_state not in ALLOWED_TRANSITIONS.get(expected_from, set()):
            raise GitStewardError(f"ongeldige sprong {expected_from} -> {target_state}")
        if target_values["sprint"] != source_values["sprint"]:
            raise GitStewardError("coördinatietransitie mag het sprintnummer niet wijzigen")

        target_reached = current_values == target_values
        if current_values["state"] != expected_from and not target_reached:
            raise GitStewardError(
                f"stale source-state: main staat op {current_values['state']}, verwacht {expected_from}"
            )

        progress_delta = self._progress_delta(source["progress.md"], target["progress.md"])
        merged_progress = current_progress
        if progress_delta and progress_delta not in current_progress:
            separator = b"" if not current_progress or current_progress.endswith(b"\n") else b"\n"
            merged_progress = current_progress + separator + progress_delta.lstrip(b"\n")
        merged_handoff = current_handoff
        if not target_reached:
            if current_values != source_values:
                raise GitStewardError(
                    "CAS-baton verloor de race door gewijzigde frontmatter; "
                    "herlees verse main en herbereken de volledige transitie"
                )
            # The frontmatter is one semantic CAS value: swap the complete target,
            # never combine fields from different observations.
            merged_handoff = target["handoff.md"]
        return {
            "handoff.md": merged_handoff,
            "progress.md": merged_progress,
        }

    def _stage_coordination(self, checkout: Path, snapshots: Mapping[str, bytes]) -> bool:
        for relative, content in snapshots.items():
            (checkout / relative).write_bytes(content)
        self._run_git(["add", "--", *COORDINATION_PATHS], cwd=checkout)
        names = self._run_git(["diff", "--cached", "--name-only", "--"], cwd=checkout).stdout.splitlines()
        unexpected = sorted(set(names) - set(COORDINATION_PATHS))
        if unexpected:
            raise GitStewardError(f"fail-closed: onverwachte staged bestanden: {', '.join(unexpected)}")
        return bool(names)

    def _commit(self, checkout: Path) -> None:
        self._run_git(
            [
                "-c",
                f"user.name={STEWARD_NAME}",
                "-c",
                f"user.email={STEWARD_EMAIL}",
                "commit",
                "--quiet",
                "-m",
                "chore: sync pipeline coordination",
                "--",
                *COORDINATION_PATHS,
            ],
            cwd=checkout,
        )

    def _consume_local_coordination(self) -> None:
        self._run_git(
            ["restore", "--staged", "--worktree", "--source=HEAD", "--", *COORDINATION_PATHS],
            cwd=self.repo,
        )
        branch = self._run_git(["branch", "--show-current"], cwd=self.repo).stdout.strip()
        non_coord = self._run_git(
            ["status", "--porcelain", "--", ".", ":(exclude)handoff.md", ":(exclude)progress.md"],
            cwd=self.repo,
        ).stdout.strip()
        if branch == self.branch and not non_coord:
            def update_main() -> None:
                self._run_git(["fetch", self.remote, self.branch], cwd=self.repo)
                self._run_git(["merge", "--ff-only", f"{self.remote}/{self.branch}"], cwd=self.repo)

            self._retry("lokale main-synchronisatie", update_main, recovery=lambda: self._cleanup_lock(self.repo))

    def sync(self, *, expected_from: str, source_sha: str) -> bool:
        """CAS a coordination transition onto a freshly observed ``main`` parent."""
        self._cleanup_lock(self.repo)
        target = {key: self._normalized(value) for key, value in self._snapshots().items()}
        remote_url = self._remote_url()
        with tempfile.TemporaryDirectory(prefix="alv-git-steward-") as temporary:
            last_push_error: GitStewardError | None = None
            for attempt in range(1, self.attempts + 1):
                checkout = Path(temporary) / f"main-{attempt}"
                self._clone_once(remote_url, checkout)
                source = self._source_snapshots(checkout, source_sha)
                fresh = self._decide_fresh_transition(
                    checkout, target=target, source=source, expected_from=expected_from
                )
                changed = self._stage_coordination(checkout, fresh)
                if not changed:
                    self._consume_local_coordination()
                    return False
                self._commit(checkout)
                try:
                    self._push_once(checkout)
                except GitStewardError as exc:
                    last_push_error = exc
                    if attempt == self.attempts:
                        break
                    self.sleeper(self.backoff_seconds * (2 ** (attempt - 1)))
                    continue
                try:
                    self._consume_local_coordination()
                except GitStewardError as exc:
                    print(
                        "GitSteward WAARSCHUWING: main-push is geslaagd; "
                        f"lokale post-push-opruiming faalde: {exc}",
                        file=sys.stderr,
                    )
                return True
            assert last_push_error is not None
            raise GitStewardError(
                f"CAS-push verloor na {self.attempts} pogingen de race: {last_push_error}"
            )

    def _observe_main(self) -> tuple[str, dict[str, bytes]]:
        remote_url = self._remote_url()
        with tempfile.TemporaryDirectory(prefix="alv-git-steward-observe-") as temporary:
            checkout = Path(temporary) / "main"
            self._retry("main-observatie", lambda: self._clone_once(remote_url, checkout))
            sha = self._run_git(["rev-parse", "HEAD"], cwd=checkout).stdout.strip()
            snapshots = {
                relative: self._normalized((checkout / relative).read_bytes())
                for relative in COORDINATION_PATHS
            }
        return sha, snapshots

    def _open_pull_requests(self, repository: str) -> list[Mapping[str, object]]:
        result = subprocess.run(
            [
                "gh", "pr", "list", "--repo", repository, "--state", "open",
                "--base", "main", "--limit", "100", "--json", "number,state,baseRefName,headRefName,labels",
            ],
            cwd=self.repo,
            env=self._environment(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if result.returncode:
            detail = " ".join((result.stderr or result.stdout or "onbekende GitHub-fout").splitlines())[:200]
            raise GitStewardError(f"open PR's konden niet fail-closed worden gelezen: {self._redact(detail)}")
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise GitStewardError("open PR-observatie gaf geen geldige JSON") from exc
        if not isinstance(payload, list):
            raise GitStewardError("open PR-observatie is geen lijst")
        return payload

    @staticmethod
    def _candidate_bytes(candidate: Path, relative: str) -> bytes:
        path = candidate / relative
        if path.is_symlink() or not path.is_file():
            raise GitStewardError(f"kandidaatbestand ontbreekt of is onveilig: {relative}")
        try:
            return path.read_bytes()
        except OSError as exc:
            raise GitStewardError(f"kandidaatbestand onleesbaar: {relative}") from exc

    def activate_sprint(
        self,
        candidate: Path,
        *,
        repository: str,
        pull_requests: Sequence[Mapping[str, object]] | None = None,
        now: str | None = None,
    ) -> bool:
        """Validate and atomically publish a candidate sprint from fresh main."""
        candidate = candidate.resolve()
        remote_url = self._remote_url()
        observed_prs = list(pull_requests) if pull_requests is not None else self._open_pull_requests(repository)
        with tempfile.TemporaryDirectory(prefix="alv-git-steward-activate-") as temporary:
            checkout = Path(temporary) / "main"
            self._retry("main-observatie", lambda: self._clone_once(remote_url, checkout))
            head_sha = self._run_git(["rev-parse", "HEAD"], cwd=checkout).stdout.strip().lower()
            errors: list[str] = []

            try:
                activation = json.loads(self._candidate_bytes(candidate, "activation.json").decode("utf-8"))
                if not isinstance(activation, Mapping):
                    raise ValueError("geen object")
                previous_sprint = int(activation["previous_sprint"])
                resolution = str(activation["resolution"])
                if set(activation) != {"previous_sprint", "resolution"}:
                    errors.append("activation.json heeft ontbrekende of onverwachte velden")
            except (GitStewardError, UnicodeError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
                activation = {}
                previous_sprint = -1
                resolution = ""
                errors.append(f"activation.json is ongeldig: {exc}")

            config_path = candidate / "pipeline-sprint.json"
            try:
                metadata = load_sprint_metadata(config_path)
            except PipelineGuardError as exc:
                metadata = None
                errors.append(str(exc))

            try:
                current_handoff_text = (checkout / "handoff.md").read_text(encoding="utf-8-sig")
                current_values = parse_frontmatter(current_handoff_text)
                validate_values(current_values)
            except (OSError, UnicodeError, HandoffValidationError) as exc:
                current_values = {}
                errors.append(f"actieve baton is ongeldig: {exc}")

            try:
                current_config = json.loads(
                    (checkout / "config/pipeline-sprint.json").read_text(encoding="utf-8")
                )
                current_config_sprint = int(current_config["sprint"])
            except (OSError, UnicodeError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
                current_config_sprint = -1
                errors.append(f"actieve config is ongeldig: {exc}")

            try:
                candidate_handoff_text = self._candidate_bytes(candidate, "handoff.md").decode("utf-8-sig")
                candidate_values = parse_frontmatter(candidate_handoff_text)
                validate_values(candidate_values)
            except (GitStewardError, UnicodeError, HandoffValidationError) as exc:
                candidate_handoff_text = ""
                candidate_values = {}
                errors.append(f"kandidaat-baton is ongeldig: {exc}")

            try:
                sprint_text = self._candidate_bytes(candidate, "sprint.md").decode("utf-8-sig")
                progress = self._candidate_bytes(candidate, "progress.md")
            except (GitStewardError, UnicodeError) as exc:
                sprint_text = ""
                progress = b""
                errors.append(str(exc))

            if current_values:
                current_sprint = int(current_values["sprint"])
                if current_config_sprint != current_sprint:
                    errors.append("actieve config en baton verschillen van sprintnummer")
                if previous_sprint != current_sprint:
                    errors.append("previous_sprint wijkt af van de nog actieve baton")
                completed = resolution == "completed" and current_values["state"] == "SPRINT_DONE"
                incident = (
                    resolution == "incident"
                    and current_values["state"] == "BLOCKED"
                    and current_values["owner"] == "bas"
                )
                if not (completed or incident):
                    errors.append("vorige sprint is niet formeel beëindigd of als incident afgesloten")
                if metadata is not None and metadata.sprint != current_sprint + 1:
                    errors.append("kandidaat-sprintnummer is niet exact de opvolger")
            if metadata is not None:
                try:
                    validate_coherence(
                        metadata,
                        mode="activation",
                        current_branch="main",
                        head_sha=head_sha,
                    )
                except CoherenceError as exc:
                    errors.append(str(exc))
                exists = self._run_git(["cat-file", "-e", f"{metadata.base_sha}^{{commit}}"], cwd=checkout, check=False)
                if exists.returncode:
                    errors.append("basis-SHA bestaat niet als bereikbare commit")
                branch_exists = self._run_git(
                    ["ls-remote", "--heads", remote_url, f"refs/heads/{metadata.branch}"],
                    cwd=checkout,
                    check=False,
                )
                if branch_exists.returncode:
                    errors.append("doelbranch kon niet fail-closed worden geobserveerd")
                elif branch_exists.stdout.strip():
                    errors.append("doelbranch bestaat al; kies een verse sprintbranch")
                tag_result = self._run_git(
                    ["ls-remote", "--tags", remote_url, f"refs/tags/{metadata.release_tag}"],
                    cwd=checkout,
                    check=False,
                )
                if tag_result.returncode:
                    errors.append("infra-tag kon niet fail-closed worden geobserveerd")
                else:
                    tag_sha = tag_result.stdout.split()[0] if tag_result.stdout.split() else None
                    try:
                        verify_reserved_tag(metadata, tag_sha)
                    except PipelineGuardError as exc:
                        errors.append(str(exc))
                if f"sprint {metadata.sprint}" not in sprint_text.casefold():
                    errors.append("sprintdocument noemt het kandidaat-sprintnummer niet")
                if metadata.branch not in sprint_text:
                    errors.append("sprintdocument noemt de kandidaat-branch niet")
                if candidate_values and candidate_values.get("sprint") != str(metadata.sprint):
                    errors.append("baton-sprint wijkt af van config")
            if candidate_values and (
                candidate_values.get("state") != "ARCHITECTUUR"
                or candidate_values.get("owner") != "claude"
            ):
                errors.append("Claude-kandidaat moet ARCHITECTUUR blijven; alleen activate-sprint zet READY_FOR_DEV")
            if candidate_handoff_text and len(candidate_handoff_text.splitlines()) > 20:
                errors.append("kandidaat-handoff overschrijdt de limiet van 20 regels")
            current_progress = self._normalized((checkout / "progress.md").read_bytes())
            if progress and not self._normalized(progress).startswith(current_progress):
                errors.append("kandidaat-progress moet de actuele append-only historie behouden")
            for pr in observed_prs:
                branch = str(pr.get("headRefName", ""))
                labels = pr.get("labels", [])
                label_names = {
                    str(label.get("name", "")).casefold()
                    for label in labels if isinstance(label, Mapping)
                } if isinstance(labels, list) else set()
                if str(pr.get("state")) == "OPEN" and str(pr.get("baseRefName")) == "main" and (
                    branch.startswith("agent/") or "pipeline" in label_names
                ):
                    errors.append(
                        f"open pipeline-PR #{pr.get('number')} ({branch}) moet vóór activatie worden gesloten"
                    )
            if errors:
                raise GitStewardError("activatie geweigerd: " + "; ".join(errors))

            assert metadata is not None and candidate_values
            activated_values = {
                **candidate_values,
                "state": "READY_FOR_DEV",
                "owner": "codex",
                "since": now or _utc_now(),
                "next": "gemini",
                "action_required_by": "none",
                "blocked": "false",
            }
            validate_values(activated_values)
            activated_handoff = _render_handoff(candidate_handoff_text, activated_values).encode("utf-8")
            snapshots = {
                "config/pipeline-sprint.json": self._candidate_bytes(candidate, "pipeline-sprint.json"),
                "sprint.md": self._candidate_bytes(candidate, "sprint.md"),
                "progress.md": progress,
                "handoff.md": activated_handoff,
            }
            for relative, content in snapshots.items():
                destination = checkout / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(content)
            self._run_git(["add", "--", *ACTIVATION_PATHS], cwd=checkout)
            names = self._run_git(["diff", "--cached", "--name-only", "--"], cwd=checkout).stdout.splitlines()
            if set(names) != set(ACTIVATION_PATHS):
                raise GitStewardError("atomische activatie moet exact config/sprint/progress/handoff wijzigen")
            self._run_git(
                [
                    "-c", f"user.name={STEWARD_NAME}", "-c", f"user.email={STEWARD_EMAIL}",
                    "commit", "--quiet", "-m", f"chore(sprint-{metadata.sprint}): activate sprint atomically",
                    "--", *ACTIVATION_PATHS,
                ],
                cwd=checkout,
            )
            self._push_once(checkout)
            return True

    def block_finalize(self, role: str, note: str, *, now: str | None = None) -> bool:
        """Write an idempotent BLOCKED baton/progress entry and synchronize it."""
        normalized_role = role.lower()
        if normalized_role not in ROLE_NAMES:
            raise GitStewardError(f"onbekende rol voor block-finalize: {role}")
        safe_note = _single_line(note)
        handoff_path = self.repo / "handoff.md"
        progress_path = self.repo / "progress.md"
        try:
            local_original = handoff_path.read_text(encoding="utf-8-sig")
            local_values = parse_frontmatter(local_original)
            validate_values(local_values)
            local_progress = progress_path.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeError, HandoffValidationError) as exc:
            raise GitStewardError(f"ongeldige handoff; block-finalize geweigerd: {exc}") from exc

        timestamp = now or _utc_now()

        def write_blocked(original: str, values: Mapping[str, str], progress: str) -> None:
            if values["state"] != "BLOCKED":
                updated = {
                    **values,
                    "state": "BLOCKED",
                    "owner": "bas",
                    "since": timestamp,
                    "next": "none",
                    "action_required_by": "bas",
                    "blocked": "true",
                    "note": safe_note,
                }
                validate_values(updated)
                rendered = _render_handoff(original, updated)
                validate_values(parse_frontmatter(rendered))
                _atomic_write(handoff_path, rendered)

            suffix = f"· {ROLE_NAMES[normalized_role]} · **BLOCKED: {safe_note}**"
            if not any(line.rstrip().endswith(suffix) for line in progress.splitlines()):
                separator = "" if not progress or progress.endswith("\n") else "\n"
                _atomic_write(progress_path, f"{progress}{separator}- {timestamp[:10]} {suffix}\n")

        # Preserve a recoverable local BLOCKED state even when remote observation is down.
        write_blocked(local_original, local_values, local_progress)
        try:
            source_sha, observed = self._observe_main()
            original = observed["handoff.md"].decode("utf-8-sig")
            values = parse_frontmatter(original)
            validate_values(values)
        except (OSError, UnicodeError, HandoffValidationError, GitStewardError) as exc:
            raise GitStewardError(f"ongeldige handoff; block-finalize geweigerd: {exc}") from exc
        progress = observed["progress.md"].decode("utf-8-sig")
        write_blocked(original, values, progress)
        return self.sync(expected_from=values["state"], source_sha=source_sha)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--remote", default="origin")
    parser.add_argument("--branch", default="main")
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--backoff-seconds", type=float, default=1.0)
    parser.add_argument("--stale-lock-seconds", type=float, default=120.0)
    commands = parser.add_subparsers(dest="command", required=True)
    sync = commands.add_parser("sync")
    sync.add_argument("--expected-from", required=True)
    sync.add_argument("--source-sha", required=True)
    blocked = commands.add_parser("block_finalize")
    blocked.add_argument("--role", required=True, choices=sorted(ROLE_NAMES))
    blocked.add_argument("--note", required=True)
    activate = commands.add_parser("activate-sprint")
    activate.add_argument("--candidate", type=Path, required=True)
    activate.add_argument("--repository", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        steward = GitSteward(
            args.repo,
            remote=args.remote,
            branch=args.branch,
            token_file=args.token_file,
            attempts=args.attempts,
            backoff_seconds=args.backoff_seconds,
            stale_lock_seconds=args.stale_lock_seconds,
        )
        if args.command == "sync":
            changed = steward.sync(expected_from=args.expected_from, source_sha=args.source_sha)
        elif args.command == "block_finalize":
            changed = steward.block_finalize(args.role, args.note)
        else:
            changed = steward.activate_sprint(args.candidate, repository=args.repository)
    except GitStewardError as exc:
        print(f"GIT_STEWARD_BLOCKED: {exc}", file=sys.stderr)
        return 1
    print(f"GIT_STEWARD_OK: {'coordination commit gepusht' if changed else 'idempotente no-op'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
