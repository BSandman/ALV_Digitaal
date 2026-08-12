from __future__ import annotations

import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]


class StatusDashboardContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.script = (REPO / "scripts" / "status.ps1").read_text(encoding="utf-8")

    def test_dashboard_covers_baton_autorun_activity_and_pull_requests(self) -> None:
        for required in (
            "=== HANDOFF ===",
            "=== AUTORUN ===",
            "autorun.paused",
            "autorun-status.json",
            "autorun.log",
            "gh pr list",
            "statusCheckRollup",
            "OPEN PR'S / CHECKS",
        ):
            with self.subTest(required=required):
                self.assertIn(required, self.script)

    def test_html_is_local_ignored_self_contained_and_auto_refreshing(self) -> None:
        self.assertIn('meta http-equiv="refresh"', self.script)
        self.assertIn("[switch]$Watch", self.script)
        self.assertIn("& $PSCommandPath -Html", self.script)
        self.assertIn("[Net.WebUtility]::HtmlEncode", self.script)
        self.assertIn("[IO.File]::WriteAllText", self.script)
        gitignore = (REPO / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("status.html", gitignore)
        self.assertIn("autorun-status.json", gitignore)
        self.assertIn("autorun.paused", gitignore)


if __name__ == "__main__":
    unittest.main()
