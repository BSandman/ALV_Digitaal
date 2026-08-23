from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))


def load_script(name: str):
    spec = importlib.util.spec_from_file_location(name, REPO / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


steward_module = load_script("git_steward")
lint_handoff = load_script("lint_handoff")


HANDOFF = """---
sprint: 11
state: DEV_IN_PROGRESS
owner: codex
since: 2026-08-20T20:41:04Z
next: gemini
action_required_by: none
blocked: false
note: "Codex bouwt de GitSteward-kern."
---

# handoff.md
"""


def git(cwd: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if check and result.returncode:
        raise AssertionError(f"git {' '.join(args)} failed: {result.stderr}")
    return result


class GitFixture:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.remote = root / "remote.git"
        self.seed = root / "seed"
        self.work = root / "work"
        git(root, "init", "--bare", str(self.remote))
        git(root, "init", "-b", "main", str(self.seed))
        git(self.seed, "config", "user.name", "Fixture")
        git(self.seed, "config", "user.email", "fixture@example.invalid")
        (self.seed / "handoff.md").write_text(HANDOFF, encoding="utf-8")
        (self.seed / "progress.md").write_text("# Progress\n", encoding="utf-8")
        (self.seed / "product.txt").write_text("release-v1\n", encoding="utf-8")
        git(self.seed, "add", ".")
        git(self.seed, "commit", "-m", "seed")
        git(self.seed, "remote", "add", "origin", str(self.remote))
        git(self.seed, "push", "-u", "origin", "main")
        git(self.remote, "symbolic-ref", "HEAD", "refs/heads/main")
        git(root, "clone", "--quiet", str(self.remote), str(self.work))
        git(self.work, "config", "user.name", "Fixture")
        git(self.work, "config", "user.email", "fixture@example.invalid")

    def remote_text(self, path: str) -> str:
        return git(self.remote, "show", f"main:{path}").stdout

    def remote_count(self) -> int:
        return int(git(self.remote, "rev-list", "--count", "main").stdout.strip())

    def remote_sha(self) -> str:
        return git(self.remote, "rev-parse", "main").stdout.strip()

    def steward(self, **kwargs):
        return steward_module.GitSteward(
            self.work,
            backoff_seconds=0,
            sleeper=lambda _: None,
            process_checker=lambda: False,
            **kwargs,
        )


class RacingSteward(steward_module.GitSteward):
    def __init__(self, *args, competing_clone: Path, race_action=None, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.competing_clone = competing_clone
        self.race_action = race_action
        self.push_attempts = 0

    def _push_once(self, checkout: Path) -> None:
        self.push_attempts += 1
        if self.push_attempts == 1:
            if self.race_action:
                self.race_action(self.competing_clone)
            else:
                product = self.competing_clone / "product.txt"
                product.write_text("release-v2\n", encoding="utf-8")
                git(self.competing_clone, "add", "product.txt")
                git(self.competing_clone, "commit", "-m", "concurrent product commit")
                git(self.competing_clone, "push", "origin", "main")
        super()._push_once(checkout)


class GitStewardTests(unittest.TestCase):
    def test_sync_pushes_only_coordination_and_preserves_staged_product(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = GitFixture(Path(directory))
            git(fixture.work, "switch", "-c", "agent/work")
            (fixture.work / "product.txt").write_text("unfinished product\n", encoding="utf-8")
            git(fixture.work, "add", "product.txt")
            updated = HANDOFF.replace("DEV_IN_PROGRESS", "READY_FOR_TEST").replace(
                "owner: codex", "owner: gemini"
            )
            (fixture.work / "handoff.md").write_text(updated, encoding="utf-8")
            (fixture.work / "progress.md").write_text("# Progress\n- core gereed\n", encoding="utf-8")

            changed = fixture.steward().sync(
                expected_from="DEV_IN_PROGRESS", source_sha=fixture.remote_sha()
            )

            self.assertTrue(changed)
            self.assertIn("READY_FOR_TEST", fixture.remote_text("handoff.md"))
            self.assertIn("core gereed", fixture.remote_text("progress.md"))
            self.assertEqual(fixture.remote_text("product.txt"), "release-v1\n")
            staged = git(fixture.work, "diff", "--cached", "--name-only").stdout.splitlines()
            self.assertEqual(staged, ["product.txt"])
            self.assertEqual((fixture.work / "product.txt").read_text(encoding="utf-8"), "unfinished product\n")

    def test_block_finalize_is_pushed_clean_in_sync_and_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = GitFixture(Path(directory))
            steward = fixture.steward()

            changed = steward.block_finalize(
                "codex", "Runner stopte vóór commit.", now="2026-08-20T21:00:00Z"
            )

            self.assertTrue(changed)
            values = lint_handoff.parse_frontmatter(fixture.remote_text("handoff.md"))
            lint_handoff.validate_values(values)
            self.assertEqual(values["state"], "BLOCKED")
            self.assertEqual(values["owner"], "bas")
            self.assertEqual(values["action_required_by"], "bas")
            self.assertIn("Codex · **BLOCKED: Runner stopte vóór commit.**", fixture.remote_text("progress.md"))
            self.assertEqual(git(fixture.work, "status", "--porcelain").stdout, "")
            self.assertEqual(git(fixture.work, "rev-list", "--left-right", "--count", "HEAD...@{u}").stdout.strip(), "0\t0")

            count = fixture.remote_count()
            changed_again = steward.block_finalize(
                "codex", "Runner stopte vóór commit.", now="2026-08-20T21:05:00Z"
            )
            self.assertFalse(changed_again)
            self.assertEqual(fixture.remote_count(), count)
            occurrences = fixture.remote_text("progress.md").count("Runner stopte vóór commit.")
            self.assertEqual(occurrences, 1)

    def test_stale_index_lock_is_removed_but_fresh_or_live_lock_is_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = GitFixture(Path(directory))
            lock = fixture.work / ".git" / "index.lock"
            lock.write_text("stale", encoding="utf-8")
            old = time.time() - 600
            os.utime(lock, (old, old))
            removed = steward_module.cleanup_stale_index_lock(
                fixture.work,
                stale_after_seconds=120,
                process_checker=lambda: False,
            )
            self.assertTrue(removed)
            self.assertFalse(lock.exists())

            lock.write_text("fresh", encoding="utf-8")
            self.assertFalse(
                steward_module.cleanup_stale_index_lock(
                    fixture.work,
                    stale_after_seconds=120,
                    process_checker=lambda: False,
                )
            )
            old = time.time() - 600
            os.utime(lock, (old, old))
            self.assertFalse(
                steward_module.cleanup_stale_index_lock(
                    fixture.work,
                    stale_after_seconds=120,
                    process_checker=lambda: True,
                )
            )
            self.assertTrue(lock.exists())

    def test_non_fast_forward_reloads_fresh_main_without_rebasing_old_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as empty_home, tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {
                "GIT_CONFIG_GLOBAL": os.devnull,
                "GIT_CONFIG_SYSTEM": os.devnull,
                "HOME": empty_home,
                "USERPROFILE": empty_home,
                "XDG_CONFIG_HOME": empty_home,
            },
        ):
            fixture = GitFixture(Path(directory))
            competing = Path(directory) / "competing"
            git(Path(directory), "clone", "--quiet", str(fixture.remote), str(competing))
            git(competing, "config", "user.name", "Competitor")
            git(competing, "config", "user.email", "competitor@example.invalid")
            (fixture.work / "progress.md").write_text("# Progress\n- coordination\n", encoding="utf-8")
            steward = RacingSteward(
                fixture.work,
                competing_clone=competing,
                attempts=3,
                backoff_seconds=0,
                sleeper=lambda _: None,
                process_checker=lambda: False,
            )

            source_sha = fixture.remote_sha()
            self.assertTrue(steward.sync(expected_from="DEV_IN_PROGRESS", source_sha=source_sha))
            self.assertEqual(steward.push_attempts, 2)
            self.assertEqual(fixture.remote_text("product.txt"), "release-v2\n")
            self.assertIn("coordination", fixture.remote_text("progress.md"))
            log = git(fixture.remote, "log", "--format=%s", "main").stdout
            self.assertIn("concurrent product commit", log)
            self.assertIn("sync pipeline coordination", log)
            environment = steward._environment()
            self.assertEqual(environment["GIT_AUTHOR_NAME"], steward_module.STEWARD_NAME)
            self.assertEqual(environment["GIT_AUTHOR_EMAIL"], steward_module.STEWARD_EMAIL)
            self.assertEqual(environment["GIT_COMMITTER_NAME"], steward_module.STEWARD_NAME)
            self.assertEqual(environment["GIT_COMMITTER_EMAIL"], steward_module.STEWARD_EMAIL)

            self.assertNotIn("rebase", git(fixture.remote, "log", "--format=%s", "main").stdout.lower())

    def test_stale_source_state_and_invalid_jump_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = GitFixture(Path(directory))
            source_sha = fixture.remote_sha()
            invalid = HANDOFF.replace("DEV_IN_PROGRESS", "READY_FOR_VALIDATION").replace(
                "owner: codex", "owner: claude"
            )
            (fixture.work / "handoff.md").write_text(invalid, encoding="utf-8")
            with self.assertRaisesRegex(steward_module.GitStewardError, "ongeldige sprong"):
                fixture.steward().sync(expected_from="DEV_IN_PROGRESS", source_sha=source_sha)

            (fixture.work / "handoff.md").write_text(
                HANDOFF.replace("DEV_IN_PROGRESS", "READY_FOR_TEST").replace(
                    "owner: codex", "owner: gemini"
                ), encoding="utf-8"
            )
            remote_handoff = fixture.seed / "handoff.md"
            remote_handoff.write_text(
                HANDOFF.replace("DEV_IN_PROGRESS", "BLOCKED")
                .replace("owner: codex", "owner: bas")
                .replace("next: gemini", "next: none")
                .replace("action_required_by: none", "action_required_by: bas")
                .replace("blocked: false", "blocked: true"),
                encoding="utf-8",
            )
            git(fixture.seed, "add", "handoff.md")
            git(fixture.seed, "commit", "-m", "concurrent state transition")
            git(fixture.seed, "push", "origin", "main")
            with self.assertRaisesRegex(steward_module.GitStewardError, "stale source-state"):
                fixture.steward().sync(expected_from="DEV_IN_PROGRESS", source_sha=source_sha)

    def test_target_already_reached_is_idempotent_noop(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = GitFixture(Path(directory))
            source_sha = fixture.remote_sha()
            target = HANDOFF.replace("DEV_IN_PROGRESS", "READY_FOR_TEST").replace(
                "owner: codex", "owner: gemini"
            )
            progress = "# Progress\n- codex gereed\n"
            (fixture.work / "handoff.md").write_text(target, encoding="utf-8")
            (fixture.work / "progress.md").write_text(progress, encoding="utf-8")
            (fixture.seed / "handoff.md").write_text(target, encoding="utf-8")
            (fixture.seed / "progress.md").write_text(progress, encoding="utf-8")
            git(fixture.seed, "add", "handoff.md", "progress.md")
            git(fixture.seed, "commit", "-m", "target reached elsewhere")
            git(fixture.seed, "push", "origin", "main")
            before = fixture.remote_count()

            changed = fixture.steward().sync(
                expected_from="DEV_IN_PROGRESS", source_sha=source_sha
            )

            self.assertFalse(changed)
            self.assertEqual(fixture.remote_count(), before)

    def test_concurrent_progress_append_is_preserved_with_local_append(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = GitFixture(Path(directory))
            competing = Path(directory) / "competing-progress"
            git(Path(directory), "clone", "--quiet", str(fixture.remote), str(competing))
            git(competing, "config", "user.name", "Competitor")
            git(competing, "config", "user.email", "competitor@example.invalid")
            source_sha = fixture.remote_sha()
            (fixture.work / "handoff.md").write_text(
                HANDOFF.replace("DEV_IN_PROGRESS", "READY_FOR_TEST").replace(
                    "owner: codex", "owner: gemini"
                ), encoding="utf-8"
            )
            (fixture.work / "progress.md").write_text(
                "# Progress\n- lokale codex-regel\n", encoding="utf-8"
            )

            def append_competing_progress(repo: Path) -> None:
                (repo / "progress.md").write_text(
                    "# Progress\n- concurrerende regel\n", encoding="utf-8"
                )
                git(repo, "add", "progress.md")
                git(repo, "commit", "-m", "concurrent progress append")
                git(repo, "push", "origin", "main")

            steward = RacingSteward(
                fixture.work,
                competing_clone=competing,
                race_action=append_competing_progress,
                attempts=3,
                backoff_seconds=0,
                sleeper=lambda _: None,
                process_checker=lambda: False,
            )
            self.assertTrue(steward.sync(expected_from="DEV_IN_PROGRESS", source_sha=source_sha))
            remote_progress = fixture.remote_text("progress.md")
            self.assertIn("concurrerende regel", remote_progress)
            self.assertIn("lokale codex-regel", remote_progress)

    def test_retry_uses_three_attempts_with_exponential_backoff(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = GitFixture(Path(directory))
            delays: list[float] = []
            steward = steward_module.GitSteward(
                fixture.work,
                attempts=3,
                backoff_seconds=0.25,
                sleeper=delays.append,
                process_checker=lambda: False,
            )
            calls = 0

            def transient_operation() -> None:
                nonlocal calls
                calls += 1
                if calls < 3:
                    raise steward_module.GitStewardError("transient")

            steward._retry("fixture", transient_operation)
            self.assertEqual(calls, 3)
            self.assertEqual(delays, [0.25, 0.5])

    def test_persistent_remote_failure_leaves_local_blocked_state_for_bas(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = GitFixture(Path(directory))
            git(fixture.work, "remote", "set-url", "origin", str(Path(directory) / "missing.git"))
            steward = fixture.steward(attempts=3)

            with self.assertRaisesRegex(steward_module.GitStewardError, "na 3 pogingen"):
                steward.block_finalize(
                    "codex", "Git-credentials of remote blijvend onbruikbaar.", now="2026-08-20T21:00:00Z"
                )

            values = lint_handoff.parse_frontmatter((fixture.work / "handoff.md").read_text(encoding="utf-8"))
            self.assertEqual(values["state"], "BLOCKED")
            self.assertEqual(values["action_required_by"], "bas")
            self.assertIn("Git-credentials of remote blijvend onbruikbaar", (fixture.work / "progress.md").read_text(encoding="utf-8"))
            self.assertEqual(fixture.remote_count(), 1)

    def test_corrupt_handoff_fails_closed_without_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = GitFixture(Path(directory))
            corrupt = "---\nstate: GOKWERK\n---\n"
            (fixture.work / "handoff.md").write_text(corrupt, encoding="utf-8")
            before_progress = (fixture.work / "progress.md").read_bytes()

            with self.assertRaises(steward_module.GitStewardError):
                fixture.steward().block_finalize("codex", "Mag niet muteren")

            self.assertEqual((fixture.work / "handoff.md").read_text(encoding="utf-8"), corrupt)
            self.assertEqual((fixture.work / "progress.md").read_bytes(), before_progress)
            self.assertEqual(fixture.remote_count(), 1)

    def test_token_must_live_in_secure_and_is_redacted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = GitFixture(Path(directory))
            outside = fixture.work / "token.env"
            outside.write_text("GH_TOKEN=top-secret", encoding="utf-8")
            with self.assertRaisesRegex(steward_module.GitStewardError, "secure"):
                fixture.steward(token_file=outside)

            secure = fixture.work / "mistral-lokaal" / "secure"
            secure.mkdir(parents=True)
            token_file = secure / "git-steward.env"
            token_file.write_text("GH_TOKEN=top-secret", encoding="utf-8")
            steward = fixture.steward(token_file=token_file)
            self.assertEqual(steward.token, "top-secret")
            self.assertEqual(steward._redact("fatal: top-secret rejected"), "fatal: *** rejected")


if __name__ == "__main__":
    unittest.main()
