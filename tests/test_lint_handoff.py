from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "lint_handoff", REPO / "scripts" / "lint_handoff.py"
)
assert SPEC and SPEC.loader
lint_handoff = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lint_handoff)


VALID = """---
sprint: 4
state: DEV_IN_PROGRESS
owner: codex
since: 2026-08-12T08:15:00Z
next: claude
action_required_by: none
blocked: false
note: "Codex bouwt G1."
---

# Handoff
"""


class LintHandoffTests(unittest.TestCase):
    def assert_invalid(self, text: str, expected: str) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "handoff.md"
            path.write_text(text, encoding="utf-8")
            with self.assertRaisesRegex(lint_handoff.HandoffValidationError, expected):
                lint_handoff.validate_file(path)

    def test_valid_handoff_is_green(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "handoff.md"
            path.write_text(VALID, encoding="utf-8")
            lint_handoff.validate_file(path)

    def test_invented_state_is_red(self) -> None:
        self.assert_invalid(
            VALID.replace("DEV_IN_PROGRESS", "CODEX_DO_YOUR_THING"),
            "onbekende state",
        )

    def test_missing_required_key_is_red(self) -> None:
        self.assert_invalid(VALID.replace("next: claude\n", ""), "next")

    def test_duplicate_owner_is_red(self) -> None:
        self.assert_invalid(
            VALID.replace("owner: codex\n", "owner: codex\nowner: claude\n"),
            "meer dan één keer",
        )

    def test_owner_list_is_red(self) -> None:
        self.assert_invalid(VALID.replace("owner: codex", "owner: [codex, claude]"), "scalar")

    def test_blocked_requires_bas_action(self) -> None:
        blocked = (
            VALID.replace("DEV_IN_PROGRESS", "BLOCKED")
            .replace("owner: codex", "owner: bas")
            .replace("blocked: false", "blocked: true")
        )
        self.assert_invalid(blocked, "action_required_by: bas")

    def test_state_owner_mismatch_is_red(self) -> None:
        self.assert_invalid(VALID.replace("owner: codex", "owner: claude"), "hoort bij owner")

    def test_timestamp_requires_timezone(self) -> None:
        self.assert_invalid(
            VALID.replace("2026-08-12T08:15:00Z", "2026-08-12T08:15:00"),
            "tijdzone",
        )

    def test_unclosed_quoted_note_is_red(self) -> None:
        self.assert_invalid(VALID.replace('note: "Codex bouwt G1."', 'note: "onaf'), "quote")

    def test_missing_closing_delimiter_is_red(self) -> None:
        self.assert_invalid(VALID.replace("---\n\n# Handoff", "# Handoff"), "afsluitende")


if __name__ == "__main__":
    unittest.main()
