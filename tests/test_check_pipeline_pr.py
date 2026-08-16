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
        "reviewDecision": "APPROVED",
        "latestReviews": [
            {
                "state": "APPROVED",
                "author": {"login": check_pipeline_pr.EXPECTED_REVIEWER},
            }
        ],
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

    def test_required_checks_after_many_unrelated_checks_are_evaluated(self) -> None:
        payload = green_pr()
        required = payload["statusCheckRollup"]
        payload["statusCheckRollup"] = [
            {
                "name": f"irrelevant-{index:03d}",
                "workflowName": "Andere workflow",
                "status": "COMPLETED",
                "conclusion": "SUCCESS",
            }
            for index in range(125)
        ] + required
        self.assertEqual(self.evaluate(payload).decision, "merge")

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
        active_request["latestReviews"].append({"state": "CHANGES_REQUESTED"})
        self.assertEqual(self.evaluate(active_request).decision, "noop")

        dismissed_request = green_pr()
        dismissed_request["latestReviews"].append({"state": "DISMISSED"})
        self.assertEqual(self.evaluate(dismissed_request).decision, "merge")

    def test_expected_gemini_approval_is_mandatory(self) -> None:
        missing = green_pr()
        missing["latestReviews"] = []
        result = self.evaluate(missing)
        self.assertEqual(result.decision, "noop")
        self.assertIn("goedkeuring ontbreekt", result.reason)

        wrong_author = green_pr()
        wrong_author["latestReviews"][0]["author"]["login"] = "andere-reviewer"
        self.assertEqual(self.evaluate(wrong_author).decision, "noop")

        missing_author = green_pr()
        missing_author["latestReviews"][0].pop("author")
        self.assertEqual(self.evaluate(missing_author).decision, "noop")

        invalid_reviews = green_pr()
        invalid_reviews["latestReviews"] = None
        self.assertEqual(self.evaluate(invalid_reviews).decision, "noop")

    def test_expected_gemini_reviewer_accepts_both_github_login_forms(self) -> None:
        for login in ("github-actions", "github-actions[bot]"):
            with self.subTest(login=login):
                payload = green_pr()
                payload["latestReviews"][0]["author"]["login"] = login
                self.assertEqual(self.evaluate(payload).decision, "merge")

    def test_unknown_mergeability_or_malformed_payload_is_noop(self) -> None:
        payload = green_pr()
        payload["mergeable"] = "UNKNOWN"
        self.assertEqual(self.evaluate(payload).decision, "noop")
        invalid_sha = green_pr()
        invalid_sha["headRefOid"] = "niet-een-sha"
        self.assertEqual(self.evaluate(invalid_sha).decision, "noop")
        invalid_checks = green_pr()
        invalid_checks["statusCheckRollup"] = None
        self.assertEqual(self.evaluate(invalid_checks).decision, "noop")
        self.assertEqual(self.evaluate({}).decision, "noop")


if __name__ == "__main__":
    unittest.main()
