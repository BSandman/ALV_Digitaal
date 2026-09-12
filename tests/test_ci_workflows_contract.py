from __future__ import annotations

import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]


class WorkflowContractTests(unittest.TestCase):
    def test_lane_a_has_minimal_reads_and_no_admin_endpoint(self) -> None:
        workflow = (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        self.assertIn("contents: read", workflow)
        self.assertIn("actions: read", workflow)
        self.assertIn("pull-requests: read", workflow)
        self.assertNotIn("branches/main/protection", workflow)
        self.assertNotIn("ADMIN_PREFLIGHT_APP", workflow)
        self.assertIn("check_coherence.py pr-ci", workflow)
        self.assertIn("github.event.pull_request.head.sha", workflow)

    def test_admin_preflight_is_main_only_ephemeral_and_has_no_checkout_or_artifact(self) -> None:
        workflow = (REPO / ".github/workflows/p0a-admin-preflight.yml").read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch", workflow)
        self.assertIn('GITHUB_REF\" != \"refs/heads/main', workflow)
        self.assertIn("actions/create-github-app-token@v3", workflow)
        self.assertIn("permission-administration: read", workflow)
        self.assertIn("ADMIN_PREFLIGHT_APP_CLIENT_ID", workflow)
        self.assertIn("ADMIN_PREFLIGHT_APP_PRIVATE_KEY", workflow)
        self.assertIn("ADMIN_PREFLIGHT_APP_TOKEN", workflow)
        self.assertIn("branches/main/protection", workflow)
        self.assertIn('strict\" != \"false', workflow)
        self.assertNotIn("actions/checkout", workflow)
        self.assertNotIn("upload-artifact", workflow)


if __name__ == "__main__":
    unittest.main()
