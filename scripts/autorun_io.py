#!/usr/bin/env python3
"""Small dependency-free local I/O primitives shared by autorun components."""

from __future__ import annotations

import contextlib
import os
import time
from datetime import datetime, timezone
from pathlib import Path


class AutorunIOError(RuntimeError):
    """Raised when local autorun observability cannot be safely written."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@contextlib.contextmanager
def exclusive_file_lock(path: Path, *, timeout: float = 10.0, stale_after: float = 60.0):
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = Path(f"{path}.lock")
    deadline = time.monotonic() + timeout
    while True:
        try:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except (FileExistsError, PermissionError):
            # Windows may report a sharing collision as PermissionError.
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
                raise AutorunIOError(f"lock-timeout voor {path.name}")
            time.sleep(0.02)
            continue
        except OSError as exc:
            raise AutorunIOError(f"lock kon niet worden gemaakt voor {path.name}") from exc
        else:
            try:
                with os.fdopen(descriptor, "w", encoding="ascii") as handle:
                    handle.write(f"pid={os.getpid()}\n")
                os.chmod(lock_path, 0o600)
            except OSError as exc:
                try:
                    os.close(descriptor)
                except OSError:
                    pass
                lock_path.unlink(missing_ok=True)
                raise AutorunIOError(f"lock kon niet worden vastgelegd voor {path.name}") from exc
            break
    try:
        yield
    finally:
        try:
            lock_path.unlink(missing_ok=True)
        except OSError:
            pass


def append_activity(
    role: str,
    from_state: str,
    to_state: str,
    outcome: str,
    *,
    log_path: Path,
) -> None:
    safe = lambda value: " ".join(str(value).replace("·", "-").splitlines()).strip()
    line = f"{utc_now()} · {safe(role)} · {safe(from_state)} → {safe(to_state)} · {safe(outcome)}\n"
    with exclusive_file_lock(log_path):
        try:
            with log_path.open("a", encoding="utf-8", newline="") as handle:
                handle.write(line)
                handle.flush()
                os.fsync(handle.fileno())
        except OSError as exc:
            raise AutorunIOError(f"{log_path.name} kon niet veilig worden aangevuld") from exc
