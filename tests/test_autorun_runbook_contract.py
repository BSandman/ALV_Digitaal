from __future__ import annotations

import subprocess
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
            "--config sandbox_workspace_write.network_access=true",
        ):
            self.assertIn(required, agents)
        self.assertNotIn("--ask-for-approval", agents)

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
            "ALV_NOTIFIER_STATE",
        ):
            self.assertIn(required, example)
        self.assertNotIn("ALV_AUTORUN_GEMINI_ARGV", example)

    def test_real_local_config_and_notifier_are_gitignored(self) -> None:
        gitignore = (REPO / ".gitignore").read_text(encoding="utf-8-sig")
        self.assertIn("mistral-lokaal/secure/", gitignore)
        example = (
            REPO / "mistral-lokaal" / "autorun.config.example.ps1"
        ).read_text(encoding="utf-8-sig")
        self.assertNotIn("SMTP_PASSWORD=", example)
        for local_path in (
            "mistral-lokaal/secure/autorun.config.ps1",
            "mistral-lokaal/secure/notifier.env",
        ):
            ignored = subprocess.run(
                ["git", "check-ignore", "--no-index", "--quiet", local_path],
                cwd=REPO,
                check=False,
            )
            self.assertEqual(ignored.returncode, 0, local_path)


if __name__ == "__main__":
    unittest.main()
