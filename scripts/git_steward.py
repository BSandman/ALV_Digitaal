#!/usr/bin/env python3
"""Synchronize pipeline coordination through an isolated, deterministic Git process.

The steward is deliberately limited to ``handoff.md`` and ``progress.md``.  It
clones ``main`` into a temporary directory, commits only those snapshots and
pushes that isolated checkout.  Product changes in the caller's worktree are
therefore never staged, committed or pushed by this script.
"""

from __future__ import annotations

import argparse
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


COORDINATION_PATHS = ("handoff.md", "progress.md")
DEFAULT_TOKEN_PATH = Path("mistral-lokaal/secure/git-steward.env")
ROLE_NAMES = {"codex": "Codex", "claude": "Claude", "gemini": "Gemini", "mistral": "Mistral"}


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
                    except GitStewardError:
                        pass
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

    def _pull_once(self, checkout: Path) -> None:
        self._cleanup_lock(checkout)
        self._run_git(["pull", "--rebase", self.remote, self.branch], cwd=checkout)

    def _push_once(self, checkout: Path) -> None:
        self._cleanup_lock(checkout)
        self._run_git(["push", self.remote, f"HEAD:{self.branch}"], cwd=checkout)

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
                "user.name=ALV GitSteward",
                "-c",
                "user.email=git-steward@localhost.invalid",
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

    def sync(self) -> bool:
        """Push coordination snapshots to main. Return whether a commit was made."""
        self._cleanup_lock(self.repo)
        snapshots = self._snapshots()
        remote_url = self._remote_url()
        with tempfile.TemporaryDirectory(prefix="alv-git-steward-") as temporary:
            checkout = Path(temporary) / "main"
            self._retry(
                "clone",
                lambda: self._clone_once(remote_url, checkout),
                recovery=lambda: self._cleanup_lock(self.repo),
            )
            self._retry("pull --rebase", lambda: self._pull_once(checkout))
            changed = self._stage_coordination(checkout, snapshots)
            if changed:
                self._commit(checkout)
                self._retry(
                    "push",
                    lambda: self._push_once(checkout),
                    recovery=lambda: self._pull_once(checkout),
                )
            self._consume_local_coordination()
            return changed

    def block_finalize(self, role: str, note: str, *, now: str | None = None) -> bool:
        """Write an idempotent BLOCKED baton/progress entry and synchronize it."""
        normalized_role = role.lower()
        if normalized_role not in ROLE_NAMES:
            raise GitStewardError(f"onbekende rol voor block-finalize: {role}")
        safe_note = _single_line(note)
        handoff_path = self.repo / "handoff.md"
        progress_path = self.repo / "progress.md"
        try:
            original = handoff_path.read_text(encoding="utf-8-sig")
            values = parse_frontmatter(original)
            validate_values(values)
        except (OSError, UnicodeError, HandoffValidationError) as exc:
            raise GitStewardError(f"ongeldige handoff; block-finalize geweigerd: {exc}") from exc

        timestamp = now or _utc_now()
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

        progress = progress_path.read_text(encoding="utf-8-sig")
        suffix = f"· {ROLE_NAMES[normalized_role]} · **BLOCKED: {safe_note}**"
        if not any(line.rstrip().endswith(suffix) for line in progress.splitlines()):
            separator = "" if not progress or progress.endswith("\n") else "\n"
            _atomic_write(progress_path, f"{progress}{separator}- {timestamp[:10]} {suffix}\n")
        return self.sync()


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
    commands.add_parser("sync")
    blocked = commands.add_parser("block_finalize")
    blocked.add_argument("--role", required=True, choices=sorted(ROLE_NAMES))
    blocked.add_argument("--note", required=True)
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
            changed = steward.sync()
        else:
            changed = steward.block_finalize(args.role, args.note)
    except GitStewardError as exc:
        print(f"GIT_STEWARD_BLOCKED: {exc}", file=sys.stderr)
        return 1
    print(f"GIT_STEWARD_OK: {'coordination commit gepusht' if changed else 'idempotente no-op'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
