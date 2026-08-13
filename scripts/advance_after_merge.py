#!/usr/bin/env python3
"""Advance a green merged PR baton without performing any Git operation."""

from __future__ import annotations

import argparse
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping

from lint_handoff import HandoffValidationError, parse_frontmatter, validate_values


def _render_frontmatter(text: str, values: Mapping[str, str]) -> str:
    lines = text.lstrip("\ufeff").splitlines()
    closing = next(
        index for index, line in enumerate(lines[1:], start=1) if line.strip() == "---"
    )
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
    body = "\n".join(lines[closing + 1 :])
    return "\n".join(frontmatter) + "\n" + body + "\n"


def _write_atomic(path: Path, content: str) -> None:
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


def advance_handoff(path: Path, *, gate_green: bool, now: str | None = None) -> tuple[bool, str]:
    """Return (changed, reason); invalid or ineligible input is always a no-op."""
    if not gate_green:
        return False, "gate niet groen"

    try:
        original = path.read_text(encoding="utf-8-sig")
        values = parse_frontmatter(original)
        validate_values(values)
    except (OSError, UnicodeError, HandoffValidationError, StopIteration) as exc:
        return False, f"ongeldige handoff: {exc}"

    if values["state"] != "READY_FOR_TEST" or values["owner"] != "gemini":
        return False, f"baton reeds voorbij of niet overdraagbaar: {values['state']}/{values['owner']}"

    timestamp = now or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    updated = {
        **values,
        "state": "READY_FOR_VALIDATION",
        "owner": "claude",
        "since": timestamp,
        "next": "mistral",
        "action_required_by": "none",
        "blocked": "false",
        "note": "PR-gates en Gemini zijn groen; Claude valideert de gemergde sprint.",
    }
    try:
        validate_values(updated)
        rendered = _render_frontmatter(original, updated)
        validate_values(parse_frontmatter(rendered))
        _write_atomic(path, rendered)
    except (OSError, UnicodeError, HandoffValidationError, StopIteration) as exc:
        return False, f"veilige batonwrite geweigerd: {exc}"
    return True, "READY_FOR_TEST doorgezet naar READY_FOR_VALIDATION"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--handoff",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "handoff.md",
    )
    parser.add_argument("--gate-green", action="store_true")
    parser.add_argument("--now", help="vaste ISO-tijd voor een reproduceerbare test")
    args = parser.parse_args(argv)

    changed, reason = advance_handoff(args.handoff, gate_green=args.gate_green, now=args.now)
    print(f"{'ADVANCED' if changed else 'NOOP'}: {reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
