from __future__ import annotations

import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]


class AutorunRunbookContractTests(unittest.TestCase):
    def test_runbook_keeps_attended_and_human_deploy_guards_visible(self) -> None:
        agents = (REPO / "AGENTS.md").read_text(encoding="utf-8-sig")
        for required in (
            "--autorun --max-turns 1",
            "autorun.paused",
            "Ctrl+C",
            "attended-first",
            "action_required_by: bas",
            "Onbemand of overnight draaien blijft uit",
        ):
            self.assertIn(required, agents)

    def test_example_config_documents_runners_caps_and_notifier(self) -> None:
        example = (
            REPO / "mistral-lokaal" / "autorun.config.example.ps1"
        ).read_text(encoding="utf-8-sig")
        for required in (
            "ALV_AUTORUN_CODEX_ARGV",
            "ALV_AUTORUN_CLAUDE_ARGV",
            "ALV_AUTORUN_MISTRAL_ARGV",
            "ALV_AUTORUN_MAX_TURNS",
            "ALV_AUTORUN_MAX_WALLCLOCK_SECONDS",
            "ALV_NOTIFIER_CONFIG",
        ):
            self.assertIn(required, example)
        self.assertNotIn("ALV_AUTORUN_GEMINI_ARGV", example)


if __name__ == "__main__":
    unittest.main()
