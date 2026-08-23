from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


REPO = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "pipeline_guard", REPO / "scripts" / "pipeline_guard.py"
)
assert SPEC and SPEC.loader
pipeline_guard = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = pipeline_guard
SPEC.loader.exec_module(pipeline_guard)


def pr(number: int, *, state: str = "OPEN", branch: str = "agent/sprint-13", sha: str = "a" * 40,
       labels: list[dict[str, str]] | None = None) -> dict:
    return {
        "number": number,
        "state": state,
        "baseRefName": "main",
        "headRefName": branch,
        "headRefOid": sha,
        "headRepository": {"nameWithOwner": "BSandman/ALV_Digitaal"},
        "labels": labels or [],
    }


class PipelineIdentityTests(unittest.TestCase):
    def test_exact_open_pr_number_branch_repo_and_sha_resolve(self) -> None:
        payload = pr(23)
        result = pipeline_guard.resolve_pr_identity(
            payload,
            [payload],
            expected_number=23,
            expected_repository="BSandman/ALV_Digitaal",
            expected_branch="agent/sprint-13",
            expected_sha="a" * 40,
            follow_up_done=False,
        )
        self.assertEqual(result.decision, "open")
        self.assertEqual(result.number, 23)

    def test_zero_branch_results_need_proven_closed_and_completed_follow_up(self) -> None:
        with self.assertRaisesRegex(pipeline_guard.PipelineGuardError, "verwachte open PR"):
            pipeline_guard.resolve_pr_identity(
                pr(23), [], expected_number=23,
                expected_repository="BSandman/ALV_Digitaal",
                expected_branch="agent/sprint-13", expected_sha="a" * 40,
                follow_up_done=False,
            )
        closed = pr(23, state="MERGED")
        result = pipeline_guard.resolve_pr_identity(
            closed, [], expected_number=23,
            expected_repository="BSandman/ALV_Digitaal",
            expected_branch="agent/sprint-13", expected_sha="a" * 40,
            follow_up_done=True,
        )
        self.assertEqual(result.decision, "noop")
        self.assertIn("MERGED", result.reason)

    def test_merged_without_completed_follow_up_fails_closed(self) -> None:
        with self.assertRaisesRegex(pipeline_guard.PipelineGuardError, "vervolgactie"):
            pipeline_guard.resolve_pr_identity(
                pr(23, state="MERGED"), [], expected_number=23,
                expected_repository="BSandman/ALV_Digitaal",
                expected_branch="agent/sprint-13", expected_sha="a" * 40,
                follow_up_done=False,
            )

    def test_multiple_branch_results_fail_loudly(self) -> None:
        with self.assertRaisesRegex(pipeline_guard.PipelineGuardError, "meerdere"):
            pipeline_guard.resolve_pr_identity(
                pr(23), [pr(23), pr(24)], expected_number=23,
                expected_repository="BSandman/ALV_Digitaal",
                expected_branch="agent/sprint-13", expected_sha="a" * 40,
                follow_up_done=False,
            )

    def test_primary_identity_mismatch_fails_closed(self) -> None:
        cases = [
            ("number", pr(24)),
            ("repo", {**pr(23), "headRepository": {"nameWithOwner": "fork/repo"}}),
            ("branch", pr(23, branch="agent/other")),
            ("SHA", pr(23, sha="b" * 40)),
        ]
        for label, payload in cases:
            with self.subTest(label=label), self.assertRaises(pipeline_guard.PipelineGuardError):
                pipeline_guard.resolve_pr_identity(
                    payload, [payload], expected_number=23,
                    expected_repository="BSandman/ALV_Digitaal",
                    expected_branch="agent/sprint-13", expected_sha="a" * 40,
                    follow_up_done=False,
                )


class PipelineSetupTests(unittest.TestCase):
    def test_one_sprint_one_pr_invariant(self) -> None:
        self.assertIsNone(pipeline_guard.enforce_single_pipeline_pr([]))
        only = pr(23)
        self.assertEqual(pipeline_guard.enforce_single_pipeline_pr([only]), only)
        labelled = pr(24, branch="feat/guard", labels=[{"name": "pipeline"}])
        with self.assertRaisesRegex(pipeline_guard.PipelineGuardError, "meer dan één"):
            pipeline_guard.enforce_single_pipeline_pr([only, labelled])

    def test_metadata_reserves_version_tag_and_rejects_tag_incident(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sprint.json"
            path.write_text(json.dumps({
                "sprint": 13,
                "branch": "agent/sprint-13-cicd-p0a-fix1",
                "release_namespace": "infra",
                "version": "p0a-fix1",
                "release_tag": "infra-p0a-fix1",
                "release_sha": None,
                "require_branches_up_to_date": False,
                "native_automerge": "off",
            }), encoding="utf-8")
            metadata = pipeline_guard.load_sprint_metadata(path)
        self.assertEqual(metadata.release_tag, "infra-p0a-fix1")
        self.assertEqual(pipeline_guard.verify_reserved_tag(metadata, None), "reserved")
        with self.assertRaisesRegex(pipeline_guard.PipelineGuardError, "incident"):
            pipeline_guard.verify_reserved_tag(metadata, "c" * 40)

    def test_existing_tag_must_equal_recorded_release_sha(self) -> None:
        metadata = pipeline_guard.SprintMetadata(
            sprint=13, branch="agent/sprint-13-cicd-p0a-fix1",
            release_namespace="infra", version="p0a-fix1",
            release_tag="infra-p0a-fix1", release_sha="d" * 40,
            require_branches_up_to_date=False, native_automerge="off",
        )
        self.assertEqual(pipeline_guard.verify_reserved_tag(metadata, "d" * 40), "exact")
        with self.assertRaisesRegex(pipeline_guard.PipelineGuardError, "incident"):
            pipeline_guard.verify_reserved_tag(metadata, "e" * 40)

    def test_repository_variable_403_is_not_treated_as_off(self) -> None:
        denied = pipeline_guard.subprocess.CompletedProcess(
            ["gh", "variable", "get"], 1, stdout="", stderr="HTTP 403: Forbidden"
        )
        with mock.patch.object(pipeline_guard.subprocess, "run", return_value=denied):
            with self.assertRaisesRegex(pipeline_guard.PipelineGuardError, "PIPELINE_AUTOMERGE"):
                pipeline_guard._repository_variable(
                    "BSandman/ALV_Digitaal", "PIPELINE_AUTOMERGE"
                )

    def test_setup_blocks_active_automerge_end_to_end(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sprint.json"
            path.write_text(json.dumps({
                "sprint": 13,
                "branch": "agent/sprint-13-cicd-p0a-fix1",
                "release_namespace": "infra",
                "version": "p0a-fix1",
                "release_tag": "infra-p0a-fix1",
                "release_sha": None,
                "require_branches_up_to_date": False,
                "native_automerge": "off",
            }), encoding="utf-8")
            with (
                mock.patch.object(pipeline_guard, "_run_json", return_value=[]),
                mock.patch.object(pipeline_guard, "_existing_remote_tag", return_value=None),
            ):
                exit_code = pipeline_guard.main([
                    "setup", "--metadata", str(path),
                    "--repository", "BSandman/ALV_Digitaal",
                    "--runtime-automerge", "on",
                ])

        self.assertEqual(exit_code, 2)

    def test_live_repository_safety_requires_exact_off_disabled_and_not_strict(self) -> None:
        result = pipeline_guard.validate_live_repository_safety(
            repository_variable="off",
            workflow_state="disabled_manually",
            require_branches_up_to_date=False,
        )
        self.assertEqual(result["decision"], "ok")
        for kwargs in (
            {"repository_variable": "", "workflow_state": "disabled_manually", "require_branches_up_to_date": False},
            {"repository_variable": "OFF", "workflow_state": "disabled_manually", "require_branches_up_to_date": False},
            {"repository_variable": "off", "workflow_state": "active", "require_branches_up_to_date": False},
            {"repository_variable": "off", "workflow_state": "disabled_manually", "require_branches_up_to_date": True},
        ):
            with self.subTest(**kwargs), self.assertRaises(pipeline_guard.PipelineGuardError):
                pipeline_guard.validate_live_repository_safety(**kwargs)


class EmergencyAndMergePlanTests(unittest.TestCase):
    def test_emergency_rebase_requires_pause_and_is_dry_run(self) -> None:
        with self.assertRaisesRegex(pipeline_guard.PipelineGuardError, "pauze"):
            pipeline_guard.emergency_rebase_plan(
                paused=False, branch="agent/sprint-13", old_sha="a" * 40,
                new_main_sha="b" * 40,
            )
        plan = pipeline_guard.emergency_rebase_plan(
            paused=True, branch="agent/sprint-13", old_sha="a" * 40,
            new_main_sha="b" * 40,
        )
        self.assertTrue(plan.dry_run)
        self.assertIn("rebase", " ".join(plan.commands))
        self.assertNotIn("merge", " ".join(plan.commands))
        self.assertIn("alle checks opnieuw", plan.reason)

    def test_exact_sha_merge_enabler_stays_off_or_dry_run(self) -> None:
        off = pipeline_guard.exact_sha_merge_plan("off", 23, "a" * 40)
        dry = pipeline_guard.exact_sha_merge_plan("dry-run", 23, "a" * 40)
        self.assertFalse(off.enabled)
        self.assertTrue(dry.dry_run)
        self.assertEqual(
            dry.command,
            ("gh", "pr", "merge", "23", "--auto", "--squash", "--match-head-commit", "a" * 40),
        )
        with self.assertRaisesRegex(pipeline_guard.PipelineGuardError, "P0a"):
            pipeline_guard.exact_sha_merge_plan("on", 23, "a" * 40)


if __name__ == "__main__":
    unittest.main()
