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
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping, Sequence

from lint_handoff import (
    HandoffValidationError,
    parse_frontmatter,
    validate_file,
    validate_values,
)


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


class AutorunError(RuntimeError):
    """Raised when an autorun guardrail refuses to continue."""


class AutorunPaused(AutorunError):
    """Raised when Bas activates the kill-switch during a runner turn."""


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


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def run_git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=False,
    )


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


def build_context(progress_tail: int = DEFAULT_PROGRESS_TAIL, repo: Path = REPO) -> str:
    paths = {
        "handoff.md": repo / "handoff.md",
        "sprint.md": repo / "sprint.md",
        "bijbel.md": repo / "bijbel.md",
    }
    sections = []
    for name, path in paths.items():
        content = path.read_text(encoding="utf-8-sig").rstrip("\r\n")
        sections.append(f"===== {name} (volledig) =====\n{content}")

    progress = tail_text(repo / "progress.md", progress_tail)
    sections.append(f"===== progress.md (laatste {progress_tail} regels) =====\n{progress}")
    return "\n\n".join(sections) + "\n"


def build_runner_input(role: str, progress_tail: int = DEFAULT_PROGRESS_TAIL, repo: Path = REPO) -> str:
    instructions = (
        f"Voer exact één handoff-beurt uit als rol {role}. Volg README.md en AGENTS.md; "
        "claim een READY-beurt of hervat je eigen IN_PROGRESS-beurt, voer alleen je opgedragen "
        "werk uit en sluit af met een geldige handoff + progress-commit die je pusht. "
        "Voer nooit zelf een deploy uit; zet voor een menselijke deploy action_required_by: bas. "
        "Bij twijfel of afwijking: BLOCKED voor Bas.\n\n"
    )
    return instructions + build_context(progress_tail, repo)


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


def append_activity(
    role: str,
    from_state: str,
    to_state: str,
    outcome: str,
    *,
    log_path: Path = ACTIVITY_LOG,
) -> None:
    safe = lambda value: " ".join(str(value).replace("·", "-").splitlines()).strip()
    line = f"{utc_now()} · {safe(role)} · {safe(from_state)} → {safe(to_state)} · {safe(outcome)}\n"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8", newline="") as handle:
        handle.write(line)


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


def mark_blocked(
    role: str,
    reason: str,
    *,
    repo: Path = REPO,
    fallback_handoff: str | None = None,
    git_runner=run_git,
    notifier_runner=run_notifier,
    log_path: Path | None = None,
) -> bool:
    handoff_path = repo / "handoff.md"
    try:
        current_text = handoff_path.read_text(encoding="utf-8-sig")
        parse_frontmatter(current_text)
    except (OSError, UnicodeError, HandoffValidationError):
        if fallback_handoff is None:
            append_activity(role, "ONBEKEND", "BLOCKED", "FOUT: handoff onherstelbaar", log_path=log_path or repo / "autorun.log")
            return False
        current_text = fallback_handoff

    safe_reason = " ".join(reason.replace('"', "'").splitlines()).strip()[:180]
    previous = parse_frontmatter(current_text).get("state", "ONBEKEND")
    blocked_text = _frontmatter_with_updates(
        current_text,
        {
            "state": "BLOCKED",
            "owner": "bas",
            "since": utc_now(),
            "next": role,
            "action_required_by": "bas",
            "blocked": "true",
            "note": f"Autorun {role} gestopt: {safe_reason}; zie autorun.log.",
        },
    )
    _write_text_atomic(handoff_path, blocked_text)
    validate_file(handoff_path)

    add = git_runner(repo, "add", "handoff.md")
    commit = git_runner(
        repo,
        "commit",
        "--only",
        "-m",
        f"chore: block failed {role} autorun",
        "--",
        "handoff.md",
    )
    push = git_runner(repo, "push") if commit.returncode == 0 else commit
    git_ok = add.returncode == 0 and commit.returncode == 0 and push.returncode == 0
    notify_ok = notifier_runner(repo) == 0
    outcome = "BLOCKED + notify" if git_ok and notify_ok else "BLOCKED; git/notifier aandacht nodig"
    append_activity(role, previous, "BLOCKED", outcome, log_path=log_path or repo / "autorun.log")
    return git_ok and notify_ok


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
    if dirty.returncode != 0 or dirty.stdout.strip():
        raise AutorunError("runner liet ongecommitteerde wijzigingen achter")
    sync = git_runner(repo, "rev-list", "--left-right", "--count", "HEAD...@{u}")
    if sync.returncode != 0 or sync.stdout.replace("\t", " ").split() != ["0", "0"]:
        raise AutorunError("runner liet lokale en remote branch uit sync of zonder upstream achter")
    return final


def execute_autorun_turn(
    role: str,
    command: Sequence[str],
    *,
    progress_tail: int,
    deadline: float,
    repo: Path = REPO,
    git_runner=run_git,
    notifier_runner=run_notifier,
    log_path: Path | None = None,
) -> str:
    handoff_path = repo / "handoff.md"
    original_text = handoff_path.read_text(encoding="utf-8-sig")
    initial = read_frontmatter(handoff_path)
    initial_state = initial.get("state", "ONBEKEND")
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        mark_blocked(
            role,
            "maximale wandklok bereikt vóór runnerstart",
            repo=repo,
            fallback_handoff=original_text,
            git_runner=git_runner,
            notifier_runner=notifier_runner,
            log_path=log_path,
        )
        return "failed"

    try:
        result = act(
            command,
            build_runner_input(role, progress_tail, repo),
            repo=repo,
            timeout=remaining,
            pause_path=repo / "autorun.paused",
        )
        if result.returncode != 0:
            raise AutorunError(f"runner eindigde met exitcode {result.returncode}")
        final = verify_completed_turn(role, initial_state, repo=repo, git_runner=git_runner)
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
            git_runner=git_runner,
            notifier_runner=notifier_runner,
            log_path=log_path,
        )
        return "failed"

    notifier_code = notifier_runner(repo)
    final_state = final.get("state", "ONBEKEND")
    notify_outcome = "OK" if notifier_code == 0 else "OK; notifier gaf fout"
    append_activity(role, initial_state, final_state, notify_outcome, log_path=log_path or repo / "autorun.log")
    return "success" if notifier_code == 0 else "failed"


def run_session(
    role: str,
    *,
    autorun: bool,
    command: Sequence[str] | None,
    interval: int,
    progress_tail: int,
    max_turns: int,
    max_wallclock: int,
    once: bool = False,
    race_guard_seconds: int = RACE_GUARD_SECONDS,
    repo: Path = REPO,
) -> int:
    started_monotonic = time.monotonic()
    started_at = utc_now()
    turns = 0
    pause_path = repo / "autorun.paused"
    status_path = repo / "autorun-status.json"
    log_path = repo / "autorun.log"
    paused_logged = False

    if autorun:
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

            pull = run_git(repo, "pull", "--quiet", "--ff-only")
            if pull.returncode != 0:
                print(f"[{role}] git pull faalde — watcher stopt.", file=sys.stderr)
                append_activity(role, "SESSIE", "STOP", "git pull faalde", log_path=log_path)
                return 1
            fm = read_frontmatter(repo / "handoff.md")

            if fm.get("state") == "BLOCKED":
                print(f"[{role}] BLOCKED — wacht op Bas. note={fm.get('note')!r}")
            elif my_turn(fm, role) or (autorun and role_in_progress(fm, role)):
                if autorun and turns >= max_turns:
                    mark_blocked(
                        role,
                        f"loop-cap van {max_turns} beurten bereikt",
                        repo=repo,
                        fallback_handoff=(repo / "handoff.md").read_text(encoding="utf-8-sig"),
                        log_path=log_path,
                    )
                    return 1
                ready_turn = my_turn(fm, role)
                if ready_turn:
                    print(f"[{role}] mijn beurt gedetecteerd — race-guard {race_guard_seconds}s...")
                    if not wait_for_race_guard(race_guard_seconds, pause_path):
                        continue
                    pull = run_git(repo, "pull", "--quiet", "--ff-only")
                    if pull.returncode != 0:
                        print(f"[{role}] tweede git pull faalde — watcher stopt.", file=sys.stderr)
                        return 1
                    fm = read_frontmatter(repo / "handoff.md")
                else:
                    print(f"[{role}] hervat eigen IN_PROGRESS-beurt zonder nieuwe race-guard.")
                if my_turn(fm, role) or (autorun and role_in_progress(fm, role)):
                    if autorun:
                        assert command is not None
                        deadline = started_monotonic + max_wallclock
                        outcome = execute_autorun_turn(
                            role,
                            command,
                            progress_tail=progress_tail,
                            deadline=deadline,
                            repo=repo,
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
                    else:
                        print(f"[{role}] AAN ZET — state={fm.get('state')} note={fm.get('note')!r}")
                        print(build_context(progress_tail, repo), end="")
                else:
                    print(f"[{role}] beurt gewijzigd tijdens guard — afgebroken.")
            if once:
                return 0
            time.sleep(min(interval, max_wallclock - elapsed) if autorun else interval)
    finally:
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
    parser.add_argument("--role", required=True, choices=list(ROLE_STATE))
    parser.add_argument("--interval", type=int, default=45, help="poll-interval in seconden")
    parser.add_argument(
        "--progress-tail",
        type=int,
        default=DEFAULT_PROGRESS_TAIL,
        help="aantal laatste regels van progress.md in agentcontext (standaard: 15)",
    )
    parser.add_argument("--autorun", action="store_true", help="start geconfigureerde rol-runner")
    parser.add_argument("--max-turns", type=int, default=DEFAULT_MAX_TURNS)
    parser.add_argument("--max-wallclock", type=int, default=DEFAULT_MAX_WALLCLOCK, help="sessielimiet in seconden")
    parser.add_argument("--once", action="store_true", help="voer één poll uit en stop")
    args = parser.parse_args(argv)
    if args.interval < 1:
        parser.error("--interval moet minimaal 1 zijn")
    if args.progress_tail < 1:
        parser.error("--progress-tail moet minimaal 1 zijn")
    if args.max_turns < 1:
        parser.error("--max-turns moet minimaal 1 zijn")
    if args.max_wallclock < 1:
        parser.error("--max-wallclock moet minimaal 1 seconde zijn")

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
