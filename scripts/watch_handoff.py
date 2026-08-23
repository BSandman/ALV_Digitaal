#!/usr/bin/env python3
"""Poll the handoff baton and optionally run one bounded role turn at a time.

Autorun is opt-in. Runner commands come from local environment variables and
receive the bounded agent context on stdin; no command is hardcoded or run via a
shell. See ADR-0017 and AGENTS.md.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Mapping, Sequence

from lint_handoff import (
    HandoffValidationError,
    parse_frontmatter,
    validate_file,
    validate_values,
)
from autorun_io import append_activity, utc_now


ROLE_STATE = {
    "codex": ("READY_FOR_DEV", "DEV_IN_PROGRESS"),
    "gemini": ("READY_FOR_TEST", "TEST_IN_PROGRESS"),
    "claude": ("READY_FOR_VALIDATION", "VALIDATION_IN_PROGRESS"),
    "mistral": ("READY_FOR_INTEGRATION", "INTEGRATION_IN_PROGRESS"),
}

REPO = Path(__file__).resolve().parents[1]
HANDOFF = REPO / "handoff.md"
SPRINT = REPO / "sprint.md"
PROGRESS = REPO / "progress.md"
BIJBEL = REPO / "bijbel.md"
PAUSE_SENTINEL = REPO / "autorun.paused"
ACTIVITY_LOG = REPO / "autorun.log"
RUNTIME_STATUS = REPO / "autorun-status.json"
RACE_GUARD_SECONDS = 60
DEFAULT_PROGRESS_TAIL = 15
DEFAULT_MAX_TURNS = 3
DEFAULT_MAX_WALLCLOCK = 1800
BIJBEL_MODES = ("full", "register")
ROLE_CHARTERS = {
    "codex": "docs/gates/Codex-instructie.md",
    "mistral": "docs/gates/Mistral-instructie.md",
}

AUTORUN_DEFAULT_ENV = {
    "interval": ("ALV_AUTORUN_INTERVAL_SECONDS", 45, 3600),
    "progress_tail": ("ALV_AUTORUN_PROGRESS_TAIL", DEFAULT_PROGRESS_TAIL, 500),
    "max_turns": ("ALV_AUTORUN_MAX_TURNS", DEFAULT_MAX_TURNS, 20),
    "max_wallclock": (
        "ALV_AUTORUN_MAX_WALLCLOCK_SECONDS",
        DEFAULT_MAX_WALLCLOCK,
        4 * 60 * 60,
    ),
}


class AutorunError(RuntimeError):
    """Raised when an autorun guardrail refuses to continue."""


class AutorunPaused(AutorunError):
    """Raised when Bas activates the kill-switch during a runner turn."""


def load_autorun_defaults(
    environ: Mapping[str, str] | None = None,
) -> dict[str, int]:
    """Load positive numeric defaults from the local environment."""
    env = os.environ if environ is None else environ
    defaults: dict[str, int] = {}
    for setting, (name, fallback, maximum) in AUTORUN_DEFAULT_ENV.items():
        raw = env.get(name, "").strip()
        if not raw:
            defaults[setting] = fallback
            continue
        if not raw.isascii() or not raw.isdigit():
            raise AutorunError(f"{name} moet uitsluitend cijfers bevatten")
        value = int(raw)
        validate_numeric_bound(name, value, maximum)
        defaults[setting] = value
    return defaults


def validate_numeric_bound(name: str, value: int, maximum: int) -> None:
    if value < 1:
        raise AutorunError(f"{name} moet minimaal 1 zijn")
    if value > maximum:
        raise AutorunError(f"{name} mag maximaal {maximum} zijn")


def _create_windows_job(process: subprocess.Popen[str]):
    """Put a Windows runner tree in a kill-on-close Job Object."""
    if os.name != "nt":
        return None
    import ctypes
    from ctypes import wintypes

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_ulonglong),
            ("WriteOperationCount", ctypes.c_ulonglong),
            ("OtherOperationCount", ctypes.c_ulonglong),
            ("ReadTransferCount", ctypes.c_ulonglong),
            ("WriteTransferCount", ctypes.c_ulonglong),
            ("OtherTransferCount", ctypes.c_ulonglong),
        ]

    class BASIC_LIMITS(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class EXTENDED_LIMITS(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BASIC_LIMITS),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    kernel32.SetInformationJobObject.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

    handle = kernel32.CreateJobObjectW(None, None)
    if not handle:
        raise AutorunError("Windows Job Object kon niet worden gemaakt")
    limits = EXTENDED_LIMITS()
    limits.BasicLimitInformation.LimitFlags = 0x00002000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not kernel32.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
        kernel32.CloseHandle(handle)
        raise AutorunError("Windows Job Object kon niet veilig worden begrensd")
    if not kernel32.AssignProcessToJobObject(handle, wintypes.HANDLE(process._handle)):
        kernel32.CloseHandle(handle)
        raise AutorunError("runner kon niet aan Windows Job Object worden gekoppeld")
    return handle


def _close_windows_job(handle) -> None:
    if handle is None:
        return
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle(handle)


def run_git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=False,
    )


class MainObservation:
    """Read remote ``main`` from a clean detached worktree, never the runner tree."""

    def __init__(self, repo: Path, *, git_runner=run_git) -> None:
        self.repo = repo.resolve()
        self.git_runner = git_runner
        self._temporary: tempfile.TemporaryDirectory[str] | None = None
        self.path: Path | None = None

    def _git(self, repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
        result = self.git_runner(repo, *args)
        if result.returncode:
            raise AutorunError("schone main-observatie kon niet worden bijgewerkt")
        return result

    def open(self) -> "MainObservation":
        if self.path is not None:
            return self
        self._temporary = tempfile.TemporaryDirectory(prefix="alv-main-observation-")
        self.path = Path(self._temporary.name) / "main"
        self._git(self.repo, "fetch", "--quiet", "origin", "main")
        self._git(
            self.repo, "worktree", "add", "--quiet", "--detach", "--force",
            str(self.path), "origin/main",
        )
        self.refresh()
        return self

    def refresh(self) -> tuple[dict[str, str], str]:
        if self.path is None:
            raise AutorunError("main-observatie is niet geopend")
        self._git(self.repo, "fetch", "--quiet", "origin", "main")
        self._git(self.path, "reset", "--hard", "origin/main")
        status = self._git(self.path, "status", "--porcelain").stdout.strip()
        if status:
            raise AutorunError("main-observatie is niet schoon")
        sha = self._git(self.path, "rev-parse", "HEAD").stdout.strip()
        if not re.fullmatch(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})", sha):
            raise AutorunError("main-observatie heeft geen geldige SHA")
        validate_file(self.path / "handoff.md")
        return read_frontmatter(self.path / "handoff.md"), sha.lower()

    def close(self) -> None:
        if self.path is not None:
            self.git_runner(self.repo, "worktree", "remove", "--force", str(self.path))
        self.path = None
        if self._temporary is not None:
            self._temporary.cleanup()
            self._temporary = None

    def __enter__(self) -> "MainObservation":
        return self.open()

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.close()


def read_frontmatter(path: Path = HANDOFF) -> dict[str, str]:
    try:
        return parse_frontmatter(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, HandoffValidationError) as exc:
        raise AutorunError(f"handoff kon niet veilig worden gelezen: {exc}") from exc


def my_turn(fm: Mapping[str, str], role: str) -> bool:
    ready, _ = ROLE_STATE[role]
    return fm.get("state") == ready and fm.get("owner") == role


def role_in_progress(fm: Mapping[str, str], role: str) -> bool:
    _, in_progress = ROLE_STATE[role]
    return fm.get("state") == in_progress and fm.get("owner") == role


def tail_text(path: Path, line_count: int) -> str:
    if line_count < 1:
        raise ValueError("progress-tail moet minimaal 1 zijn")
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    return "\n".join(lines[-line_count:])


def default_bijbel_mode(role: str) -> str:
    return "full" if role == "claude" else "register"


def _bijbel_register(text: str) -> str:
    """Select the authoritative role, versioning and ADR-register sections."""
    wanted = {"2", "8", "9"}
    found: set[str] = set()
    selected: list[str] = []
    active = False
    for line in text.splitlines():
        heading = re.match(r"^##\s+(\d+)\.\s", line)
        if heading:
            number = heading.group(1)
            active = number in wanted
            if active:
                found.add(number)
        if active:
            selected.append(line)
    if found != wanted:
        missing = ", ".join(sorted(wanted - found))
        raise AutorunError(f"bijbel-register mist vereiste sectie(s): {missing}")
    return "\n".join(selected).rstrip()


def _role_context_docs(role: str, sprint: str) -> tuple[str, ...]:
    documents: list[str] = []
    charter = ROLE_CHARTERS.get(role)
    if charter:
        documents.append(charter)
    for relative in re.findall(r"`(docs/gates/[^`\r\n]+\.md)`", sprint):
        if role in Path(relative).name.lower() and relative not in documents:
            documents.append(relative)
    return tuple(documents)


def build_context(
    role: str,
    progress_tail: int = DEFAULT_PROGRESS_TAIL,
    repo: Path = REPO,
    bijbel_mode: str | None = None,
    coordination_repo: Path | None = None,
) -> str:
    mode = bijbel_mode or default_bijbel_mode(role)
    if mode not in BIJBEL_MODES:
        raise ValueError(f"bijbel-mode moet een van {', '.join(BIJBEL_MODES)} zijn")
    sections: list[str] = []
    coordination = coordination_repo or repo
    handoff = (coordination / "handoff.md").read_text(encoding="utf-8-sig").rstrip("\r\n")
    sprint = (repo / "sprint.md").read_text(encoding="utf-8-sig").rstrip("\r\n")
    sections.append(f"===== handoff.md (volledig) =====\n{handoff}")
    sections.append(f"===== sprint.md (volledig) =====\n{sprint}")

    bijbel = (repo / "bijbel.md").read_text(encoding="utf-8-sig").rstrip("\r\n")
    if mode == "full":
        sections.append(f"===== bijbel.md (volledig) =====\n{bijbel}")
    else:
        sections.append(
            "===== bijbel.md (§2 rollen + §8 versiebeheer + §9 ADR-register) =====\n"
            f"{_bijbel_register(bijbel)}"
        )

    for relative in _role_context_docs(role, sprint):
        content = (repo / relative).read_text(encoding="utf-8-sig").rstrip("\r\n")
        sections.append(f"===== {relative} (rol-taakdoc) =====\n{content}")

    progress = tail_text(coordination / "progress.md", progress_tail)
    sections.append(f"===== progress.md (laatste {progress_tail} regels) =====\n{progress}")
    return "\n\n".join(sections) + "\n"


def build_runner_input(
    role: str,
    progress_tail: int = DEFAULT_PROGRESS_TAIL,
    repo: Path = REPO,
    bijbel_mode: str | None = None,
    coordination_repo: Path | None = None,
) -> str:
    instructions = (
        f"Voer exact één handoff-beurt uit als rol {role}. Volg README.md en AGENTS.md; "
        "de watcher heeft de race-guard al voltooid, dus claim een READY-beurt direct zonder "
        "een tweede wachttijd of hervat je eigen IN_PROGRESS-beurt. Voer alleen je opgedragen "
        "werk uit en push alleen de productbranch-commit(s). Laat handoff.md en progress.md "
        "oncommitted achter voor de GitSteward; commit of push coördinatie nooit op de PR-head. "
        "Voer nooit zelf een deploy uit; zet voor een menselijke deploy action_required_by: bas. "
        "Bij twijfel of afwijking: BLOCKED voor Bas.\n\n"
    )
    return instructions + build_context(
        role, progress_tail, repo, bijbel_mode, coordination_repo=coordination_repo
    )


def load_runner_command(role: str, environ: Mapping[str, str] | None = None) -> list[str]:
    if role == "gemini":
        raise AutorunError("Gemini blijft serverless via GitHub Actions; lokale autorun is verboden")
    env = os.environ if environ is None else environ
    prefix = f"ALV_AUTORUN_{role.upper()}"
    argv_raw = env.get(f"{prefix}_ARGV", "").strip()
    if argv_raw:
        try:
            command = json.loads(argv_raw)
        except json.JSONDecodeError as exc:
            raise AutorunError(f"{prefix}_ARGV moet een JSON-lijst zijn") from exc
        if not isinstance(command, list) or not command or not all(
            isinstance(part, str) and part for part in command
        ):
            raise AutorunError(f"{prefix}_ARGV moet een niet-lege lijst strings zijn")
    else:
        raise AutorunError(f"runner ontbreekt: zet lokaal {prefix}_ARGV als JSON-lijst")
    if any("\x00" in part for part in command):
        raise AutorunError("runnercommando bevat een NUL-teken")
    return list(command)


def write_runtime_status(path: Path = RUNTIME_STATUS, **values: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"updated_at": utc_now(), **values}
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
        os.replace(temp_name, path)
    except OSError as exc:
        raise AutorunError("autorun-status kon niet atomair worden opgeslagen") from exc
    finally:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)


def _frontmatter_with_updates(text: str, updates: Mapping[str, str]) -> str:
    values = parse_frontmatter(text)
    values.update(updates)
    validate_values(values)
    note = values["note"].replace('"', "'").replace("\r", " ").replace("\n", " ")
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
    lines = text.splitlines()
    closing = next(index for index, line in enumerate(lines[1:], start=1) if line.strip() == "---")
    body = "\n".join(lines[closing + 1 :])
    return "\n".join(frontmatter) + "\n" + body + ("\n" if text.endswith(("\n", "\r")) else "")


def _write_text_atomic(path: Path, text: str) -> None:
    temp_name = ""
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False
        ) as handle:
            temp_name = handle.name
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except OSError as exc:
        raise AutorunError(f"{path.name} kon niet atomair worden bijgewerkt") from exc
    finally:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)


def run_notifier(repo: Path = REPO) -> int:
    result = subprocess.run(
        [sys.executable, str(repo / "scripts" / "notify_bas.py")],
        cwd=repo,
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode


def run_git_steward(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Invoke the credential-owning steward without exposing its captured output."""
    return subprocess.run(
        [sys.executable, str(repo / "scripts" / "git_steward.py"), "--repo", str(repo), *args],
        cwd=repo,
        capture_output=True,
        text=True,
        check=False,
    )


def sync_coordination(
    expected_from: str,
    source_sha: str,
    repo: Path = REPO,
    steward_runner=run_git_steward,
) -> None:
    try:
        result = steward_runner(
            repo, "sync", "--expected-from", expected_from, "--source-sha", source_sha
        )
    except OSError as exc:
        raise AutorunError("GitSteward kon niet worden gestart") from exc
    if result.returncode != 0:
        raise AutorunError("GitSteward kon de coördinatie na retries niet synchroniseren")


def claim_runner_turn(
    role: str,
    *,
    observed_repo: Path,
    source_sha: str,
    repo: Path = REPO,
    steward_runner=run_git_steward,
    git_runner=run_git,
) -> None:
    ready, in_progress = ROLE_STATE[role]
    original = (observed_repo / "handoff.md").read_text(encoding="utf-8-sig")
    values = parse_frontmatter(original)
    if not my_turn(values, role):
        raise AutorunError("claim geweigerd: geobserveerde baton is niet meer READY voor deze rol")
    claimed = _frontmatter_with_updates(
        original,
        {
            "state": in_progress,
            "owner": role,
            "since": utc_now(),
            "action_required_by": "none",
            "blocked": "false",
        },
    )
    _write_text_atomic(repo / "handoff.md", claimed)
    _write_text_atomic(
        repo / "progress.md",
        (observed_repo / "progress.md").read_text(encoding="utf-8-sig"),
    )
    sync_coordination(ready, source_sha, repo, steward_runner)
    verify_post_steward(repo, git_runner)


def mark_blocked(
    role: str,
    reason: str,
    *,
    repo: Path = REPO,
    fallback_handoff: str | None = None,
    steward_runner=run_git_steward,
    notifier_runner=run_notifier,
    log_path: Path | None = None,
) -> bool:
    handoff_path = repo / "handoff.md"
    restore_fallback = False
    try:
        current_text = handoff_path.read_text(encoding="utf-8-sig")
        parse_frontmatter(current_text)
    except (OSError, UnicodeError, HandoffValidationError):
        if fallback_handoff is None:
            append_activity(role, "ONBEKEND", "BLOCKED", "FOUT: handoff onherstelbaar", log_path=log_path or repo / "autorun.log")
            return False
        current_text = fallback_handoff
        restore_fallback = True

    safe_reason = " ".join(reason.replace('"', "'").splitlines()).strip()[:180]
    previous = parse_frontmatter(current_text).get("state", "ONBEKEND")
    if restore_fallback:
        _write_text_atomic(handoff_path, current_text)
    block_note = f"Autorun {role} gestopt: {safe_reason}; zie autorun.log."
    try:
        steward = steward_runner(
            repo,
            "block_finalize",
            "--role",
            role,
            "--note",
            block_note,
        )
    except OSError:
        append_activity(
            role,
            previous,
            "BLOCKED",
            "FOUT: GitSteward kon niet worden gestart",
            log_path=log_path or repo / "autorun.log",
        )
        return False
    steward_ok = steward.returncode == 0
    try:
        notify_ok = notifier_runner(repo) == 0 if steward_ok else False
    except OSError:
        notify_ok = False
    outcome = (
        "BLOCKED via GitSteward + notify"
        if steward_ok and notify_ok
        else "BLOCKED; GitSteward/notifier aandacht nodig"
    )
    append_activity(role, previous, "BLOCKED", outcome, log_path=log_path or repo / "autorun.log")
    return steward_ok and notify_ok


def act(
    command: Sequence[str],
    context: str,
    *,
    repo: Path = REPO,
    timeout: float,
    pause_path: Path | None = None,
    poll_interval: float = 0.2,
) -> subprocess.CompletedProcess[str]:
    """Run exactly one configured role turn with bounded context on stdin."""
    if timeout <= 0:
        raise AutorunError("runner kreeg geen resterende wandklok")
    deadline = time.monotonic() + timeout
    process: subprocess.Popen[str] | None = None
    windows_job = None
    try:
        with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as context_file:
            context_file.write(context)
            context_file.seek(0)
            process = subprocess.Popen(
                list(command),
                stdin=context_file,
                text=True,
                cwd=repo,
                start_new_session=os.name != "nt",
                creationflags=(
                    subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
                ),
            )
            windows_job = _create_windows_job(process)
            while process.poll() is None:
                if pause_path is not None and pause_path.exists():
                    _stop_process_tree(process, windows_job)
                    windows_job = None
                    raise AutorunPaused("kill-switch geactiveerd tijdens runner; beurt blijft hervatbaar")
                if time.monotonic() >= deadline:
                    _stop_process_tree(process, windows_job)
                    windows_job = None
                    raise AutorunError("runner overschreed de maximale wandklok")
                time.sleep(min(poll_interval, max(0.01, deadline - time.monotonic())))
            return subprocess.CompletedProcess(list(command), process.returncode)
    except AutorunError:
        if process is not None and process.poll() is None:
            _stop_process_tree(process, windows_job)
            windows_job = None
        raise
    except OSError as exc:
        if process is not None and process.poll() is None:
            _stop_process_tree(process, windows_job)
            windows_job = None
        raise AutorunError("runner kon niet worden gestart") from exc
    finally:
        # On a normal runner exit this also cleans up any leaked descendants.
        _close_windows_job(windows_job)


def _stop_process_tree(process: subprocess.Popen[str], windows_job=None) -> None:
    if process.poll() is not None:
        _close_windows_job(windows_job)
        return
    try:
        if os.name == "nt":
            _close_windows_job(windows_job)
            windows_job = None
        else:
            os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=2)
    except (OSError, subprocess.TimeoutExpired):
        try:
            if os.name != "nt":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
            process.wait(timeout=1)
        except (OSError, subprocess.TimeoutExpired):
            pass
    finally:
        _close_windows_job(windows_job)


def wait_for_race_guard(seconds: int, pause_path: Path) -> bool:
    """Wait interruptibly; return False as soon as the kill-switch appears."""
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if pause_path.exists():
            return False
        time.sleep(min(0.25, deadline - time.monotonic()))
    return not pause_path.exists()


def verify_completed_turn(
    role: str,
    initial_state: str,
    *,
    repo: Path = REPO,
    git_runner=run_git,
    source_sha: str | None = None,
) -> dict[str, str]:
    handoff_path = repo / "handoff.md"
    try:
        validate_file(handoff_path)
        final = read_frontmatter(handoff_path)
    except (HandoffValidationError, AutorunError) as exc:
        raise AutorunError(f"runner liet een ongeldige handoff achter: {exc}") from exc
    if final.get("state") == initial_state and final.get("owner") == role:
        raise AutorunError("runner rondde geen toestand-overgang af")
    if role_in_progress(final, role):
        raise AutorunError("runner liet de beurt op IN_PROGRESS achter")

    dirty = git_runner(repo, "status", "--porcelain")
    if dirty.returncode != 0:
        raise AutorunError("git-status na runner faalde")
    dirty_paths = {
        line[3:].strip().replace("\\", "/")
        for line in dirty.stdout.splitlines()
        if len(line) >= 4
    }
    unexpected = sorted(dirty_paths - {"handoff.md", "progress.md"})
    if unexpected:
        raise AutorunError(
            f"runner liet ongecommitteerde productwijzigingen achter: {', '.join(unexpected)}"
        )
    if source_sha:
        coordination_commit = git_runner(
            repo, "diff", "--quiet", source_sha, "HEAD", "--", "handoff.md", "progress.md"
        )
        if coordination_commit.returncode != 0:
            raise AutorunError("runner committe coördinatie op de PR-head")
    sync = git_runner(repo, "rev-list", "--left-right", "--count", "HEAD...@{u}")
    if sync.returncode != 0 or sync.stdout.replace("\t", " ").split() != ["0", "0"]:
        raise AutorunError("runner liet lokale en remote branch uit sync of zonder upstream achter")
    return final


def verify_post_steward(repo: Path = REPO, git_runner=run_git) -> None:
    dirty = git_runner(repo, "status", "--porcelain")
    if dirty.returncode != 0 or dirty.stdout.strip():
        raise AutorunError("GitSteward liet de runner-worktree niet schoon achter")
    sync = git_runner(repo, "rev-list", "--left-right", "--count", "HEAD...@{u}")
    if sync.returncode != 0 or sync.stdout.replace("\t", " ").split() != ["0", "0"]:
        raise AutorunError("productbranch is na GitSteward niet in sync")


def execute_autorun_turn(
    role: str,
    command: Sequence[str],
    *,
    progress_tail: int,
    bijbel_mode: str | None = None,
    deadline: float,
    repo: Path = REPO,
    coordination_repo: Path | None = None,
    source_sha: str | None = None,
    git_runner=run_git,
    steward_runner=run_git_steward,
    notifier_runner=run_notifier,
    log_path: Path | None = None,
) -> str:
    handoff_path = repo / "handoff.md"
    observed_repo = coordination_repo or repo
    original_text = (observed_repo / "handoff.md").read_text(encoding="utf-8-sig")
    initial = read_frontmatter(observed_repo / "handoff.md")
    initial_state = initial.get("state", "ONBEKEND")
    observed_sha = source_sha
    if observed_sha is None:
        observed_sha_result = git_runner(observed_repo, "rev-parse", "HEAD")
        observed_sha = observed_sha_result.stdout.strip() if observed_sha_result.returncode == 0 else ""
    if not re.fullmatch(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})", observed_sha or ""):
        raise AutorunError("runnerstart mist de exacte geobserveerde main-SHA")
    branch_head_result = git_runner(repo, "rev-parse", "HEAD")
    branch_start_sha = (
        branch_head_result.stdout.strip()
        if branch_head_result is not None and branch_head_result.returncode == 0
        else ""
    )
    if not re.fullmatch(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})", branch_start_sha):
        branch_start_sha = observed_sha
    _write_text_atomic(handoff_path, original_text)
    _write_text_atomic(
        repo / "progress.md",
        (observed_repo / "progress.md").read_text(encoding="utf-8-sig"),
    )
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        mark_blocked(
            role,
            "maximale wandklok bereikt vóór runnerstart",
            repo=repo,
            fallback_handoff=original_text,
            steward_runner=steward_runner,
            notifier_runner=notifier_runner,
            log_path=log_path,
        )
        return "failed"

    try:
        result = act(
            command,
            build_runner_input(
                role, progress_tail, repo, bijbel_mode, coordination_repo=observed_repo
            ),
            repo=repo,
            timeout=remaining,
            pause_path=repo / "autorun.paused",
        )
        if result.returncode != 0:
            raise AutorunError(f"runner eindigde met exitcode {result.returncode}")
        final = verify_completed_turn(
            role, initial_state, repo=repo, git_runner=git_runner, source_sha=branch_start_sha
        )
        sync_coordination(initial_state, observed_sha, repo, steward_runner)
        verify_post_steward(repo, git_runner)
    except AutorunPaused as exc:
        current = read_frontmatter(handoff_path)
        append_activity(
            role,
            initial_state,
            current.get("state", "ONBEKEND"),
            f"PAUSED: {exc}",
            log_path=log_path or repo / "autorun.log",
        )
        return "paused"
    except (AutorunError, OSError, UnicodeError) as exc:
        mark_blocked(
            role,
            str(exc),
            repo=repo,
            fallback_handoff=original_text,
            steward_runner=steward_runner,
            notifier_runner=notifier_runner,
            log_path=log_path,
        )
        return "failed"

    notifier_code = notifier_runner(repo)
    final_state = final.get("state", "ONBEKEND")
    if notifier_code != 0:
        mark_blocked(
            role,
            "notifier gaf een fout na de coördinatie-sync",
            repo=repo,
            fallback_handoff=original_text,
            steward_runner=steward_runner,
            notifier_runner=notifier_runner,
            log_path=log_path,
        )
        return "failed"
    append_activity(role, initial_state, final_state, "OK", log_path=log_path or repo / "autorun.log")
    return "success"


def run_pipeline_setup_guard(repo: Path = REPO) -> None:
    metadata = repo / "config" / "pipeline-sprint.json"
    if not metadata.is_file():
        return
    result = subprocess.run(
        [
            sys.executable, str(repo / "scripts" / "pipeline_guard.py"), "setup",
            "--metadata", str(metadata), "--repository", "BSandman/ALV_Digitaal",
        ],
        cwd=repo,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        raise AutorunError("pipeline setup-lint blokkeerde de sprintstart")


def run_session(
    role: str,
    *,
    autorun: bool,
    command: Sequence[str] | None,
    interval: int,
    progress_tail: int,
    bijbel_mode: str | None = None,
    max_turns: int,
    max_wallclock: int,
    once: bool = False,
    race_guard_seconds: int = RACE_GUARD_SECONDS,
    repo: Path = REPO,
    observation_factory=MainObservation,
) -> int:
    started_monotonic = time.monotonic()
    started_at = utc_now()
    turns = 0
    pause_path = repo / "autorun.paused"
    status_path = repo / "autorun-status.json"
    log_path = repo / "autorun.log"
    paused_logged = False
    fallback_handoff: str | None = None
    if pause_path.exists() and once:
        if autorun:
            write_runtime_status(
                status_path, running=False, paused=True, role=role, pid=os.getpid(),
                turns=turns, max_turns=max_turns, max_wallclock=max_wallclock,
                started_at=started_at, last_turn_at=None,
            )
        return 0
    observation = observation_factory(repo)
    try:
        observation.open()
        assert observation.path is not None
        candidate = (observation.path / "handoff.md").read_text(encoding="utf-8-sig")
        validate_values(parse_frontmatter(candidate))
        fallback_handoff = candidate
    except (OSError, UnicodeError, HandoffValidationError, AutorunError) as exc:
        mark_blocked(
            role, str(exc), repo=repo, fallback_handoff=fallback_handoff, log_path=log_path
        )
        observation.close()
        return 1

    if autorun:
        try:
            write_runtime_status(
                status_path,
                running=True,
                paused=pause_path.exists(),
                role=role,
                pid=os.getpid(),
                turns=turns,
                max_turns=max_turns,
                max_wallclock=max_wallclock,
                started_at=started_at,
                last_turn_at=None,
            )
        except AutorunError as exc:
            mark_blocked(
                role,
                str(exc),
                repo=repo,
                fallback_handoff=fallback_handoff,
                log_path=log_path,
            )
            return 1

    try:
        while True:
            elapsed = time.monotonic() - started_monotonic
            if autorun and elapsed >= max_wallclock:
                append_activity(role, "SESSIE", "STOP", "max-wallclock bereikt", log_path=log_path)
                print(f"[{role}] max-wallclock bereikt — watcher stopt.")
                return 0

            if pause_path.exists():
                if not paused_logged:
                    print(f"[{role}] autorun gepauzeerd via {pause_path.name}.")
                    append_activity(role, "SESSIE", "PAUSED", "kill-switch actief", log_path=log_path)
                    paused_logged = True
                if autorun:
                    write_runtime_status(
                        status_path,
                        running=True,
                        paused=True,
                        role=role,
                        pid=os.getpid(),
                        turns=turns,
                        max_turns=max_turns,
                        max_wallclock=max_wallclock,
                        started_at=started_at,
                        last_turn_at=None,
                    )
                if once:
                    return 0
                time.sleep(min(interval, max_wallclock - elapsed) if autorun else interval)
                continue
            if paused_logged:
                append_activity(role, "PAUSED", "SESSIE", "kill-switch opgeheven", log_path=log_path)
                paused_logged = False

            try:
                fm, observed_sha = observation.refresh()
            except (AutorunError, HandoffValidationError) as exc:
                print(f"[{role}] main-observatie faalde — watcher stopt.", file=sys.stderr)
                mark_blocked(
                    role,
                    str(exc),
                    repo=repo,
                    fallback_handoff=fallback_handoff,
                    log_path=log_path,
                )
                return 1
            assert observation.path is not None
            fallback_handoff = (observation.path / "handoff.md").read_text(encoding="utf-8-sig")

            if fm.get("state") == "BLOCKED":
                print(f"[{role}] BLOCKED — wacht op Bas. note={fm.get('note')!r}")
            elif my_turn(fm, role) or (autorun and role_in_progress(fm, role)):
                ready_turn = my_turn(fm, role)
                if ready_turn:
                    print(f"[{role}] mijn beurt gedetecteerd — race-guard {race_guard_seconds}s...")
                    if not wait_for_race_guard(race_guard_seconds, pause_path):
                        continue
                    try:
                        fm, observed_sha = observation.refresh()
                    except (AutorunError, HandoffValidationError) as exc:
                        print(f"[{role}] tweede main-observatie faalde — watcher stopt.", file=sys.stderr)
                        mark_blocked(
                            role,
                            str(exc),
                            repo=repo,
                            fallback_handoff=fallback_handoff,
                            log_path=log_path,
                        )
                        return 1
                    assert observation.path is not None
                    fallback_handoff = (observation.path / "handoff.md").read_text(encoding="utf-8-sig")
                else:
                    print(f"[{role}] hervat eigen IN_PROGRESS-beurt zonder nieuwe race-guard.")
                if my_turn(fm, role) or (autorun and role_in_progress(fm, role)):
                    if autorun:
                        assert command is not None
                        if ready_turn and role == "codex":
                            try:
                                run_pipeline_setup_guard(repo)
                            except AutorunError as exc:
                                mark_blocked(
                                    role, str(exc), repo=repo,
                                    fallback_handoff=fallback_handoff, log_path=log_path,
                                )
                                return 1
                        if ready_turn:
                            try:
                                assert observation.path is not None
                                claim_runner_turn(
                                    role,
                                    observed_repo=observation.path,
                                    source_sha=observed_sha,
                                    repo=repo,
                                )
                                fm, observed_sha = observation.refresh()
                                if not role_in_progress(fm, role):
                                    raise AutorunError("GitSteward-claim werd niet zichtbaar op main")
                                fallback_handoff = (
                                    observation.path / "handoff.md"
                                ).read_text(encoding="utf-8-sig")
                            except (AutorunError, HandoffValidationError) as exc:
                                mark_blocked(
                                    role, str(exc), repo=repo,
                                    fallback_handoff=fallback_handoff, log_path=log_path,
                                )
                                return 1
                        deadline = started_monotonic + max_wallclock
                        outcome = execute_autorun_turn(
                            role,
                            command,
                            progress_tail=progress_tail,
                            bijbel_mode=bijbel_mode,
                            deadline=deadline,
                            repo=repo,
                            coordination_repo=observation.path,
                            source_sha=observed_sha,
                            log_path=log_path,
                        )
                        if outcome != "paused":
                            turns += 1
                        write_runtime_status(
                            status_path,
                            running=outcome != "failed",
                            paused=outcome == "paused" or pause_path.exists(),
                            role=role,
                            pid=os.getpid(),
                            turns=turns,
                            max_turns=max_turns,
                            max_wallclock=max_wallclock,
                            started_at=started_at,
                            last_turn_at=utc_now(),
                        )
                        if outcome == "paused":
                            if once:
                                return 0
                            continue
                        if outcome == "failed":
                            return 1
                        if turns >= max_turns:
                            append_activity(
                                role,
                                "SESSIE",
                                "STOP",
                                f"max-turns {max_turns} bereikt",
                                log_path=log_path,
                            )
                            return 0
                    else:
                        print(f"[{role}] AAN ZET — state={fm.get('state')} note={fm.get('note')!r}")
                        print(
                            build_context(
                                role, progress_tail, repo, bijbel_mode,
                                coordination_repo=observation.path,
                            ),
                            end="",
                        )
                else:
                    print(f"[{role}] beurt gewijzigd tijdens guard — afgebroken.")
            if once:
                return 0
            time.sleep(min(interval, max_wallclock - elapsed) if autorun else interval)
    except (AutorunError, OSError, UnicodeError) as exc:
        mark_blocked(
            role,
            str(exc),
            repo=repo,
            fallback_handoff=fallback_handoff,
            log_path=log_path,
        )
        return 1
    finally:
        observation.close()
        if autorun:
            try:
                write_runtime_status(
                    status_path,
                    running=False,
                    paused=pause_path.exists(),
                    role=role,
                    pid=os.getpid(),
                    turns=turns,
                    max_turns=max_turns,
                    max_wallclock=max_wallclock,
                    started_at=started_at,
                    last_turn_at=utc_now() if turns else None,
                )
            except AutorunError:
                pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    try:
        defaults = load_autorun_defaults()
    except AutorunError as exc:
        parser.error(str(exc))
    parser.add_argument("--role", required=True, choices=list(ROLE_STATE))
    parser.add_argument(
        "--bijbel",
        choices=BIJBEL_MODES,
        help="bijbel-context; default full voor Claude, register voor overige rollen",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=defaults["interval"],
        help="poll-interval in seconden (of ALV_AUTORUN_INTERVAL_SECONDS)",
    )
    parser.add_argument(
        "--progress-tail",
        type=int,
        default=defaults["progress_tail"],
        help="aantal progress-regels in context (of ALV_AUTORUN_PROGRESS_TAIL)",
    )
    parser.add_argument("--autorun", action="store_true", help="start geconfigureerde rol-runner")
    parser.add_argument(
        "--max-turns",
        type=int,
        default=defaults["max_turns"],
        help="beurtenlimiet (of ALV_AUTORUN_MAX_TURNS)",
    )
    parser.add_argument(
        "--max-wallclock",
        type=int,
        default=defaults["max_wallclock"],
        help="sessielimiet in seconden (of ALV_AUTORUN_MAX_WALLCLOCK_SECONDS)",
    )
    parser.add_argument("--once", action="store_true", help="voer één poll uit en stop")
    args = parser.parse_args(argv)
    cli_bounds = {
        "--interval": (args.interval, AUTORUN_DEFAULT_ENV["interval"][2]),
        "--progress-tail": (
            args.progress_tail,
            AUTORUN_DEFAULT_ENV["progress_tail"][2],
        ),
        "--max-turns": (args.max_turns, AUTORUN_DEFAULT_ENV["max_turns"][2]),
        "--max-wallclock": (
            args.max_wallclock,
            AUTORUN_DEFAULT_ENV["max_wallclock"][2],
        ),
    }
    for name, (value, maximum) in cli_bounds.items():
        try:
            validate_numeric_bound(name, value, maximum)
        except AutorunError as exc:
            parser.error(str(exc))

    try:
        command = load_runner_command(args.role) if args.autorun else None
        print(
            f"watcher gestart — rol={args.role}, autorun={'aan' if args.autorun else 'uit'}, repo={REPO}"
        )
        return run_session(
            args.role,
            autorun=args.autorun,
            command=command,
            interval=args.interval,
            progress_tail=args.progress_tail,
            bijbel_mode=args.bijbel,
            max_turns=args.max_turns,
            max_wallclock=args.max_wallclock,
            once=args.once,
        )
    except AutorunError as exc:
        print(f"watcher: FOUT — {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(0)
