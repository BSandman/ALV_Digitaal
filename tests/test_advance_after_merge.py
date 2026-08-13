from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))


def load_script(name: str):
    spec = importlib.util.spec_from_file_location(name, REPO / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


advance = load_script("advance_after_merge")
lint_handoff = load_script("lint_handoff")

READY = """---
sprint: 7
state: READY_FOR_TEST
owner: gemini
since: 2026-08-13T22:00:00Z
next: claude
action_required_by: none
blocked: false
note: "PR wacht op gates."
---

# Handoff
"""


class AdvanceAfterMergeTests(unittest.TestCase):
    def make_handoff(self, directory: str, text: str = READY) -> Path:
        path = Path(directory) / "handoff.md"
        path.write_text(text, encoding="utf-8")
        return path

    def test_green_ready_baton_advances_to_claude(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self.make_handoff(directory)
            changed, reason = advance.advance_handoff(
                path, gate_green=True, now="2026-08-14T08:00:00Z"
            )
            self.assertTrue(changed, reason)
            values = lint_handoff.parse_frontmatter(path.read_text(encoding="utf-8"))
            lint_handoff.validate_values(values)
            self.assertEqual(values["state"], "READY_FOR_VALIDATION")
            self.assertEqual(values["owner"], "claude")
            self.assertEqual(values["next"], "mistral")

    def test_non_green_gate_is_byte_for_byte_noop(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self.make_handoff(directory)
            before = path.read_bytes()
            changed, _ = advance.advance_handoff(path, gate_green=False)
            self.assertFalse(changed)
            self.assertEqual(path.read_bytes(), before)

    def test_already_beyond_ready_for_test_is_idempotent(self) -> None:
        text = READY.replace("READY_FOR_TEST", "READY_FOR_VALIDATION").replace(
            "owner: gemini", "owner: claude"
        )
        with tempfile.TemporaryDirectory() as directory:
            path = self.make_handoff(directory, text)
            before = path.read_bytes()
            changed, reason = advance.advance_handoff(path, gate_green=True)
            self.assertFalse(changed)
            self.assertIn("reeds voorbij", reason)
            self.assertEqual(path.read_bytes(), before)

    def test_blocked_and_ready_for_dev_are_valid_but_non_transferable_noops(self) -> None:
        variants = [
            READY.replace("READY_FOR_TEST", "READY_FOR_DEV").replace(
                "owner: gemini", "owner: codex"
            ),
            READY.replace("READY_FOR_TEST", "BLOCKED")
            .replace("owner: gemini", "owner: bas")
            .replace("action_required_by: none", "action_required_by: bas")
            .replace("blocked: false", "blocked: true"),
        ]
        for text in variants:
            with self.subTest(state=lint_handoff.parse_frontmatter(text)["state"]):
                with tempfile.TemporaryDirectory() as directory:
                    path = self.make_handoff(directory, text)
                    before = path.read_bytes()
                    changed, reason = advance.advance_handoff(path, gate_green=True)
                    self.assertFalse(changed)
                    self.assertIn("niet overdraagbaar", reason)
                    self.assertEqual(path.read_bytes(), before)

    def test_unknown_or_invalid_state_is_noop_without_mutation(self) -> None:
        text = READY.replace("READY_FOR_TEST", "GOKWERK")
        with tempfile.TemporaryDirectory() as directory:
            path = self.make_handoff(directory, text)
            before = path.read_bytes()
            changed, reason = advance.advance_handoff(path, gate_green=True)
            self.assertFalse(changed)
            self.assertIn("ongeldige handoff", reason)
            self.assertEqual(path.read_bytes(), before)

    def test_empty_and_corrupt_handoff_are_noops_without_mutation(self) -> None:
        for text in ("", "geen frontmatter\n", "---\nstate: READY_FOR_TEST\n"):
            with self.subTest(text=text):
                with tempfile.TemporaryDirectory() as directory:
                    path = self.make_handoff(directory, text)
                    before = path.read_bytes()
                    changed, reason = advance.advance_handoff(path, gate_green=True)
                    self.assertFalse(changed)
                    self.assertIn("ongeldige handoff", reason)
                    self.assertEqual(path.read_bytes(), before)

    def test_owner_mismatch_is_noop_without_mutation(self) -> None:
        text = READY.replace("owner: gemini", "owner: codex")
        with tempfile.TemporaryDirectory() as directory:
            path = self.make_handoff(directory, text)
            before = path.read_bytes()
            changed, _ = advance.advance_handoff(path, gate_green=True)
            self.assertFalse(changed)
            self.assertEqual(path.read_bytes(), before)

    def test_render_sanitizes_quotes_and_newlines_in_note(self) -> None:
        values = lint_handoff.parse_frontmatter(READY)
        values["note"] = 'Regel "één"\nregel twee'
        rendered = advance._render_frontmatter(READY, values)
        parsed = lint_handoff.parse_frontmatter(rendered)
        lint_handoff.validate_values(parsed)
        self.assertEqual(parsed["note"], "Regel 'één' regel twee")

    def test_utf8_bom_and_crlf_are_normalized_on_advance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "handoff.md"
            path.write_bytes(b"\xef\xbb\xbf" + READY.replace("\n", "\r\n").encode("utf-8"))
            changed, reason = advance.advance_handoff(
                path, gate_green=True, now="2026-08-14T08:00:00Z"
            )
            self.assertTrue(changed, reason)
            result = path.read_bytes()
            self.assertFalse(result.startswith(b"\xef\xbb\xbf"))
            self.assertNotIn(b"\r\n", result)
            lint_handoff.validate_values(
                lint_handoff.parse_frontmatter(result.decode("utf-8"))
            )


if __name__ == "__main__":
    unittest.main()
