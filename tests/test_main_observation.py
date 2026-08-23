from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
SPEC = importlib.util.spec_from_file_location(
    "watch_handoff_observation", REPO / "scripts" / "watch_handoff.py"
)
assert SPEC and SPEC.loader
watch_handoff = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = watch_handoff
SPEC.loader.exec_module(watch_handoff)


HANDOFF = """---
sprint: 13
state: DEV_IN_PROGRESS
owner: codex
since: 2026-08-23T15:00:00Z
next: gemini
action_required_by: none
blocked: false
note: "Codex bouwt P0a."
---

# handoff
"""


def git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True, check=False
    )
    if result.returncode:
        raise AssertionError(result.stderr)
    return result


class MainObservationTests(unittest.TestCase):
    def test_observation_is_detached_clean_and_ignores_runner_tree_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = root / "remote.git"
            seed = root / "seed"
            runner = root / "runner"
            git(root, "init", "--bare", str(remote))
            git(root, "init", "-b", "main", str(seed))
            git(seed, "config", "user.name", "Fixture")
            git(seed, "config", "user.email", "fixture@example.invalid")
            (seed / "handoff.md").write_text(HANDOFF, encoding="utf-8")
            (seed / "progress.md").write_text("# Progress\n", encoding="utf-8")
            git(seed, "add", ".")
            git(seed, "commit", "-m", "seed")
            git(seed, "remote", "add", "origin", str(remote))
            git(seed, "push", "-u", "origin", "main")
            git(remote, "symbolic-ref", "HEAD", "refs/heads/main")
            git(root, "clone", "--quiet", str(remote), str(runner))
            git(runner, "switch", "-c", "agent/sprint-13")
            (runner / "handoff.md").write_text(
                HANDOFF.replace("DEV_IN_PROGRESS", "BLOCKED"), encoding="utf-8"
            )

            observation = watch_handoff.MainObservation(runner).open()
            try:
                values, sha = observation.refresh()
                assert observation.path is not None
                self.assertNotEqual(observation.path.resolve(), runner.resolve())
                self.assertEqual(values["state"], "DEV_IN_PROGRESS")
                self.assertEqual(
                    git(observation.path, "status", "--porcelain").stdout, ""
                )
                self.assertEqual(
                    sha, git(remote, "rev-parse", "main").stdout.strip()
                )
            finally:
                observation.close()


if __name__ == "__main__":
    unittest.main()
