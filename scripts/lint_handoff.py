#!/usr/bin/env python3
"""Validate handoff.md size and frontmatter without third-party dependencies."""

from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime
from pathlib import Path


REQUIRED_KEYS = {
    "sprint",
    "state",
    "owner",
    "since",
    "next",
    "action_required_by",
    "blocked",
    "note",
}

# This mapping is the single executable definition of the AGENTS.md statemachine.
STATE_OWNERS = {
    "ARCHITECTUUR": {"claude", "bas"},
    "READY_FOR_DEV": {"codex"},
    "DEV_IN_PROGRESS": {"codex"},
    "READY_FOR_TEST": {"gemini"},
    "TEST_IN_PROGRESS": {"gemini"},
    "READY_FOR_VALIDATION": {"claude"},
    "VALIDATION_IN_PROGRESS": {"claude"},
    "READY_FOR_INTEGRATION": {"mistral"},
    "INTEGRATION_IN_PROGRESS": {"mistral"},
    "BLOCKED": {"bas"},
    "SPRINT_DONE": {"claude", "bas"},
}
OWNERS = {"claude", "codex", "gemini", "mistral", "bas"}
MAX_HANDOFF_LINES = 20


class HandoffValidationError(ValueError):
    """Raised when handoff frontmatter violates the pipeline contract."""


def _scalar(raw_value: str, key: str) -> str:
    value = raw_value.strip()
    if not value:
        raise HandoffValidationError(f"'{key}' mag niet leeg zijn")
    if value[0] in "[{" or value in {"|", ">"}:
        raise HandoffValidationError(f"'{key}' moet precies één scalar zijn, geen lijst of blok")
    if value[0] in {'"', "'"} and (len(value) < 2 or value[-1] != value[0]):
        raise HandoffValidationError(f"'{key}' heeft een niet-afgesloten quote")
    if value[-1] in {'"', "'"} and value[0] != value[-1]:
        raise HandoffValidationError(f"'{key}' heeft een onverwachte afsluitende quote")
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1]
    return value


def parse_frontmatter(text: str) -> dict[str, str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise HandoffValidationError("frontmatter moet beginnen met '---'")

    try:
        closing_index = next(
            index for index, line in enumerate(lines[1:], start=1) if line.strip() == "---"
        )
    except StopIteration as exc:
        raise HandoffValidationError("afsluitende '---' van frontmatter ontbreekt") from exc

    values: dict[str, str] = {}
    for line_number, line in enumerate(lines[1:closing_index], start=2):
        if not line.strip():
            continue
        if line[:1].isspace() or ":" not in line:
            raise HandoffValidationError(
                f"ongeldige frontmatterregel {line_number}: verwacht 'sleutel: waarde'"
            )
        key, raw_value = line.split(":", 1)
        key = key.strip()
        if not re.fullmatch(r"[a-z_]+", key):
            raise HandoffValidationError(f"ongeldige sleutel op regel {line_number}: {key!r}")
        if key in values:
            raise HandoffValidationError(f"sleutel '{key}' komt meer dan één keer voor")
        values[key] = _scalar(raw_value, key)

    return values


def validate_values(values: dict[str, str]) -> None:
    missing = sorted(REQUIRED_KEYS - values.keys())
    if missing:
        raise HandoffValidationError(f"verplichte sleutel(s) ontbreken: {', '.join(missing)}")

    unknown = sorted(values.keys() - REQUIRED_KEYS)
    if unknown:
        raise HandoffValidationError(f"onbekende sleutel(s): {', '.join(unknown)}")

    state = values["state"]
    owner = values["owner"]
    if state not in STATE_OWNERS:
        raise HandoffValidationError(f"onbekende state: {state!r}")
    if owner not in OWNERS:
        raise HandoffValidationError(f"onbekende owner: {owner!r}")
    if owner not in STATE_OWNERS[state]:
        expected = "/".join(sorted(STATE_OWNERS[state]))
        raise HandoffValidationError(
            f"state {state!r} hoort bij owner {expected!r}, niet {owner!r}"
        )

    try:
        since = datetime.fromisoformat(values["since"].replace("Z", "+00:00"))
    except ValueError as exc:
        raise HandoffValidationError("'since' moet een geldige ISO-tijd zijn") from exc
    if since.tzinfo is None:
        raise HandoffValidationError("'since' moet een ISO-tijd met tijdzone zijn")

    blocked_raw = values["blocked"].lower()
    if blocked_raw not in {"true", "false"}:
        raise HandoffValidationError("'blocked' moet booleaans true of false zijn")
    blocked = blocked_raw == "true"
    if blocked != (state == "BLOCKED"):
        raise HandoffValidationError("alleen state BLOCKED moet 'blocked: true' hebben")

    action_required_by = values["action_required_by"]
    if state == "BLOCKED" and action_required_by != "bas":
        raise HandoffValidationError("state BLOCKED vereist 'action_required_by: bas'")
    if action_required_by not in {"none", "bas"}:
        raise HandoffValidationError("'action_required_by' moet 'none' of 'bas' zijn")

    if values["next"] not in OWNERS | {"none"}:
        raise HandoffValidationError("'next' moet een bekende rol of 'none' zijn")
    if "\n" in values["note"] or "\r" in values["note"]:
        raise HandoffValidationError("'note' moet op één regel staan")


def validate_file(path: Path) -> None:
    try:
        # utf-8-sig accepts a Windows-authored BOM while behaving as UTF-8 otherwise.
        text = path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as exc:
        raise HandoffValidationError(f"kan {path} niet als UTF-8 lezen: {exc}") from exc
    line_count = len(text.splitlines())
    if line_count > MAX_HANDOFF_LINES:
        raise HandoffValidationError(
            f"handoff.md telt {line_count} regels; maximaal {MAX_HANDOFF_LINES} toegestaan"
        )
    validate_values(parse_frontmatter(text))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "path",
        nargs="?",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "handoff.md",
    )
    args = parser.parse_args(argv)

    try:
        validate_file(args.path)
    except HandoffValidationError as exc:
        print(f"Handoff-gate: ROOD — {exc}", file=sys.stderr)
        return 1

    print(f"Handoff-gate: GROEN — {args.path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
