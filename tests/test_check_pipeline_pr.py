from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "check_pipeline_pr", REPO / "scripts" / "check_pipeline_pr.py"
)
assert SPEC and SPEC.loader
check_pipeline_pr = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = check_pipeline_pr
SPEC.loader.exec_module(check_pipeline_pr)


def green_pr() -> dict:
    return {
        "state": "OPEN",
        "isDraft": False,
        "mergeable": "MERGEABLE",
        "baseRefName": "main",
        "headRefName": "agent/sprint-7",
        "headRefOid": "a" * 40,
        "headRepository": {"name": "ALV_Digitaal", "nameWithOwner": "BSandman/ALV_Digitaal"},
        "headRepositoryOwner": {"login": "BSandman"},
        "labels": [],
        "reviewDecision": "",
        "latestReviews": [],
        "statusCheckRollup": [
            {
                "name": name,
                "workflowName": workflow,
                "status": "COMPLETED",
                "conclusion": "SUCCESS",
            }
            for name, workflow in sorted(check_pipeline_pr.REQUIRED_CHECKS.items())
        ],
    }


class CheckPipelinePrTests(unittest.TestCase):
    def evaluate(self, payload: dict):
        return check_pipeline_pr.evaluate_pr(payload, repository="BSandman/ALV_Digitaal")

    def test_green_agent_pr_is_mergeable(self) -> None:
        self.assertEqual(self.evaluate(green_pr()).decision, "merge")

    def test_pipeline_label_is_allowed_for_non_agent_branch(self) -> None:
        payload = green_pr()
        payload["headRefName"] = "feat/gecontroleerd"
        payload["labels"] = [{"name": "pipeline"}]
        self.assertEqual(self.evaluate(payload).decision, "merge")

    def test_merged_green_pr_is_recoverable_advance_only(self) -> None:
        payload = green_pr()
        payload["state"] = "MERGED"
        payload["mergeable"] = "UNKNOWN"
        self.assertEqual(self.evaluate(payload).decision, "advance")

    def test_missing_or_failed_check_is_noop(self) -> None:
        missing = green_pr()
        missing["statusCheckRollup"] = missing["statusCheckRollup"][1:]
        self.assertEqual(self.evaluate(missing).decision, "noop")
        failed = green_pr()
        failed["statusCheckRollup"][0]["conclusion"] = "FAILURE"
        self.assertEqual(self.evaluate(failed).decision, "noop")
        spoofed = green_pr()
        spoofed["statusCheckRollup"][0]["workflowName"] = "Onverwachte workflow"
        self.assertEqual(self.evaluate(spoofed).decision, "noop")

    def test_retried_check_with_conflicting_result_is_fail_closed(self) -> None:
        payload = green_pr()
        retried = dict(payload["statusCheckRollup"][0])
        retried["conclusion"] = "FAILURE"
        payload["statusCheckRollup"].append(retried)
        result = self.evaluate(payload)
        self.assertEqual(result.decision, "noop")
        self.assertIn("check niet groen", result.reason)

    def test_review_request_draft_wrong_repo_and_wrong_base_are_noop(self) -> None:
        mutations = [
            ("reviewDecision", "CHANGES_REQUESTED"),
            ("isDraft", True),
            ("baseRefName", "release"),
        ]
        for key, value in mutations:
            with self.subTest(key=key):
                payload = green_pr()
                payload[key] = value
                self.assertEqual(self.evaluate(payload).decision, "noop")
        fork = green_pr()
        fork["headRepository"]["nameWithOwner"] = "vreemd/ALV_Digitaal"
        self.assertEqual(self.evaluate(fork).decision, "noop")

        active_request = green_pr()
        active_request["latestReviews"] = [{"state": "CHANGES_REQUESTED"}]
        self.assertEqual(self.evaluate(active_request).decision, "noop")

        dismissed_request = green_pr()
        dismissed_request["latestReviews"] = [{"state": "DISMISSED"}]
        self.assertEqual(self.evaluate(dismissed_request).decision, "merge")

    def test_unknown_mergeability_or_malformed_payload_is_noop(self) -> None:
        payload = green_pr()
        payload["mergeable"] = "UNKNOWN"
        self.assertEqual(self.evaluate(payload).decision, "noop")
        invalid_sha = green_pr()
        invalid_sha["headRefOid"] = "niet-een-sha"
        self.assertEqual(self.evaluate(invalid_sha).decision, "noop")
        self.assertEqual(self.evaluate({}).decision, "noop")


if __name__ == "__main__":
    unittest.main()
