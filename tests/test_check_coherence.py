from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
SPEC = importlib.util.spec_from_file_location("check_coherence", REPO / "scripts/check_coherence.py")
assert SPEC and SPEC.loader
check_coherence = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check_coherence)
from pipeline_guard import SprintMetadata


META = SprintMetadata(
    sprint=14,
    branch="agent/sprint-14-veilige-activatie",
    base_sha="a" * 40,
    release_namespace="infra",
    version="sprint-14-p0a-herstel",
    release_tag="infra-sprint-14-p0a-herstel",
    release_sha=None,
    require_branches_up_to_date=False,
    native_automerge="off",
)


class CoherenceTests(unittest.TestCase):
    def test_activation_mode_allows_main_pointing_at_future_feature_branch(self) -> None:
        result = check_coherence.validate_coherence(
            META, mode="activation", current_branch="main", head_sha="a" * 40
        )
        self.assertEqual(result["mode"], "activation")

    def test_feature_mode_requires_manifest_branch(self) -> None:
        check_coherence.validate_coherence(
            META, mode="feature", current_branch=META.branch, head_sha="b" * 40
        )
        with self.assertRaisesRegex(check_coherence.CoherenceError, "verwacht"):
            check_coherence.validate_coherence(
                META, mode="feature", current_branch="main", head_sha="a" * 40
            )

    def test_pr_ci_mode_requires_exact_branch_and_sha(self) -> None:
        check_coherence.validate_coherence(
            META,
            mode="pr-ci",
            current_branch="",
            head_sha="c" * 40,
            pr_head=META.branch,
            pr_head_sha="c" * 40,
        )
        with self.assertRaisesRegex(check_coherence.CoherenceError, "PR-head.*checkout-SHA"):
            check_coherence.validate_coherence(
                META,
                mode="pr-ci",
                current_branch="",
                head_sha="d" * 40,
                pr_head="agent/verkeerd",
                pr_head_sha="c" * 40,
            )


if __name__ == "__main__":
    unittest.main()
