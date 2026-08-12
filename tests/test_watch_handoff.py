from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
SPEC = importlib.util.spec_from_file_location(
    "watch_handoff", REPO / "scripts" / "watch_handoff.py"
)
assert SPEC and SPEC.loader
watch_handoff = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = watch_handoff
SPEC.loader.exec_module(watch_handoff)


READY_HANDOFF = '''---
sprint: 5
state: READY_FOR_DEV
owner: codex
since: 2026-08-12T12:00:00Z
next: claude
action_required_by: none
blocked: false
note: "Bouw de volgende taak."
---

# Handoff
'''

VALIDATED_HANDOFF = READY_HANDOFF.replace("READY_FOR_DEV", "READY_FOR_VALIDATION").replace(
    "owner: codex", "owner: claude"
)


class WatchHandoffContextTests(unittest.TestCase):
    def make_repo(self, directory: str) -> Path:
        repo = Path(directory)
        (repo / "handoff.md").write_text("HANDOFF-HELEMAAL\nregel-2\n", encoding="utf-8")
        (repo / "sprint.md").write_text("SPRINT-HELEMAAL\n", encoding="utf-8")
        (repo / "bijbel.md").write_text("BIJBEL-HELEMAAL\nlaatste-bijbelregel\n", encoding="utf-8")
        (repo / "progress.md").write_text(
            "\n".join(f"progress-{number:02d}" for number in range(1, 21)) + "\n",
            encoding="utf-8",
        )
        return repo

    def test_context_contains_full_control_files_and_default_progress_tail(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            context = watch_handoff.build_context(repo=self.make_repo(directory))

        self.assertIn("HANDOFF-HELEMAAL\nregel-2", context)
        self.assertIn("SPRINT-HELEMAAL", context)
        self.assertIn("BIJBEL-HELEMAAL\nlaatste-bijbelregel", context)
        self.assertIn("progress.md (laatste 15 regels)", context)
        self.assertNotIn("progress-05", context)
        self.assertIn("progress-06", context)
        self.assertIn("progress-20", context)

    def test_progress_tail_is_configurable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            context = watch_handoff.build_context(
                progress_tail=3, repo=self.make_repo(directory)
            )

        self.assertNotIn("progress-17", context)
        self.assertIn("progress-18", context)
        self.assertIn("progress-19", context)
        self.assertIn("progress-20", context)

    def test_progress_shorter_than_tail_is_included_completely(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            (repo / "progress.md").write_text("eerste\ntweede\n", encoding="utf-8")
            context = watch_handoff.build_context(progress_tail=15, repo=repo)

        self.assertIn("eerste\ntweede", context)

    def test_non_positive_tail_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            with self.assertRaisesRegex(ValueError, "minimaal 1"):
                watch_handoff.build_context(progress_tail=0, repo=repo)

    def test_utf8_bom_is_not_forwarded_into_context(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            (repo / "bijbel.md").write_text("BIJBEL-BOM\n", encoding="utf-8-sig")
            context = watch_handoff.build_context(repo=repo)

        self.assertIn("BIJBEL-BOM", context)
        self.assertNotIn("\ufeff", context)


class WatchHandoffAutorunTests(unittest.TestCase):
    def make_repo(self, directory: str, handoff: str = READY_HANDOFF) -> Path:
        repo = Path(directory)
        (repo / "scripts").mkdir()
        (repo / "handoff.md").write_text(handoff, encoding="utf-8")
        (repo / "sprint.md").write_text("SPRINT\n", encoding="utf-8")
        (repo / "bijbel.md").write_text("BIJBEL\n", encoding="utf-8")
        (repo / "progress.md").write_text("PROGRESS\n", encoding="utf-8")
        return repo

    @staticmethod
    def clean_git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
        stdout = "0\t0\n" if args[:3] == ("rev-list", "--left-right", "--count") else ""
        return subprocess.CompletedProcess(["git", *args], 0, stdout=stdout, stderr="")

    def test_runner_command_prefers_json_argv_and_never_hardcodes_role_cli(self) -> None:
        command = watch_handoff.load_runner_command(
            "codex",
            {"ALV_AUTORUN_CODEX_ARGV": json.dumps(["local-runner", "--one-turn"])},
        )
        self.assertEqual(command, ["local-runner", "--one-turn"])

    def test_runner_json_preserves_windows_path_spaces_and_backslashes(self) -> None:
        windows_path = r"C:\Program Files\Local Runner\runner.exe"
        command = watch_handoff.load_runner_command(
            "codex",
            {"ALV_AUTORUN_CODEX_ARGV": json.dumps([windows_path, "--one-turn"])},
        )
        self.assertEqual(command, [windows_path, "--one-turn"])

    def test_missing_runner_and_local_gemini_are_rejected(self) -> None:
        with self.assertRaisesRegex(watch_handoff.AutorunError, "runner ontbreekt"):
            watch_handoff.load_runner_command("codex", {})
        with self.assertRaisesRegex(watch_handoff.AutorunError, "serverless"):
            watch_handoff.load_runner_command("gemini", {})

    def test_act_passes_context_on_stdin_without_shell(self) -> None:
        command = [
            sys.executable,
            "-c",
            "import sys; sys.exit(0 if sys.stdin.read() == 'BEGRENSD' else 7)",
        ]
        with tempfile.TemporaryDirectory() as directory:
            result = watch_handoff.act(command, "BEGRENSD", repo=Path(directory), timeout=5)
        self.assertEqual(result.returncode, 0)

    def test_successful_turn_requires_valid_clean_and_pushed_transition(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            notifications = []

            def fake_act(command, context, *, repo, timeout, pause_path=None):
                self.assertIn("===== bijbel.md (volledig) =====", context)
                self.assertIn("Voer exact één handoff-beurt uit als rol codex", context)
                self.assertIn("Voer nooit zelf een deploy uit", context)
                (repo / "handoff.md").write_text(VALIDATED_HANDOFF, encoding="utf-8")
                return subprocess.CompletedProcess(command, 0)

            with mock.patch.object(watch_handoff, "act", side_effect=fake_act):
                result = watch_handoff.execute_autorun_turn(
                    "codex",
                    ["runner"],
                    progress_tail=15,
                    deadline=watch_handoff.time.monotonic() + 10,
                    repo=repo,
                    git_runner=self.clean_git,
                    notifier_runner=lambda current_repo: notifications.append(current_repo) or 0,
                    log_path=repo / "autorun.log",
                )

            self.assertEqual(result, "success")
            self.assertEqual(notifications, [repo])
            log = (repo / "autorun.log").read_text(encoding="utf-8")
            self.assertIn("READY_FOR_DEV → READY_FOR_VALIDATION · OK", log)

    def test_nonzero_runner_blocks_commits_pushes_and_notifies(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            git_calls = []
            notifications = []

            def fake_git(current_repo, *args):
                git_calls.append(args)
                return subprocess.CompletedProcess(["git", *args], 0, stdout="", stderr="")

            with mock.patch.object(
                watch_handoff,
                "act",
                return_value=subprocess.CompletedProcess(["runner"], 9),
            ):
                result = watch_handoff.execute_autorun_turn(
                    "codex",
                    ["runner"],
                    progress_tail=15,
                    deadline=watch_handoff.time.monotonic() + 10,
                    repo=repo,
                    git_runner=fake_git,
                    notifier_runner=lambda current_repo: notifications.append(current_repo) or 0,
                    log_path=repo / "autorun.log",
                )

            self.assertEqual(result, "failed")
            blocked = watch_handoff.read_frontmatter(repo / "handoff.md")
            self.assertEqual(blocked["state"], "BLOCKED")
            self.assertEqual(blocked["owner"], "bas")
            self.assertEqual(blocked["action_required_by"], "bas")
            self.assertEqual(blocked["blocked"], "true")
            self.assertEqual([call[0] for call in git_calls], ["add", "commit", "push"])
            self.assertEqual(notifications, [repo])

    def test_paused_runner_keeps_current_baton_resumable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            git_calls = []
            notifications = []
            with mock.patch.object(
                watch_handoff,
                "act",
                side_effect=watch_handoff.AutorunPaused("kill-switch geactiveerd"),
            ):
                outcome = watch_handoff.execute_autorun_turn(
                    "codex",
                    ["runner"],
                    progress_tail=15,
                    deadline=watch_handoff.time.monotonic() + 10,
                    repo=repo,
                    git_runner=lambda current_repo, *args: git_calls.append(args),
                    notifier_runner=lambda current_repo: notifications.append(current_repo) or 0,
                    log_path=repo / "autorun.log",
                )

            self.assertEqual(outcome, "paused")
            self.assertEqual(watch_handoff.read_frontmatter(repo / "handoff.md")["state"], "READY_FOR_DEV")
            self.assertEqual(git_calls, [])
            self.assertEqual(notifications, [])
            self.assertIn("PAUSED", (repo / "autorun.log").read_text(encoding="utf-8"))

    def test_in_progress_or_dirty_success_is_rejected(self) -> None:
        in_progress = READY_HANDOFF.replace("READY_FOR_DEV", "DEV_IN_PROGRESS")
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory, in_progress)
            with self.assertRaisesRegex(watch_handoff.AutorunError, "IN_PROGRESS"):
                watch_handoff.verify_completed_turn(
                    "codex", "READY_FOR_DEV", repo=repo, git_runner=self.clean_git
                )

        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory, VALIDATED_HANDOFF)

            def dirty_git(current_repo, *args):
                stdout = (
                    " M productcode\n"
                    if args[:2] == ("status", "--porcelain")
                    else "0\t0\n"
                )
                return subprocess.CompletedProcess(["git", *args], 0, stdout=stdout, stderr="")

            with self.assertRaisesRegex(watch_handoff.AutorunError, "ongecommitteerde"):
                watch_handoff.verify_completed_turn(
                    "codex", "READY_FOR_DEV", repo=repo, git_runner=dirty_git
                )

    def test_pause_sentinel_prevents_pull_and_runner_in_once_mode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            (repo / "autorun.paused").write_text("pauze\n", encoding="utf-8")
            with mock.patch.object(watch_handoff, "run_git") as git_mock:
                result = watch_handoff.run_session(
                    "codex",
                    autorun=True,
                    command=["runner"],
                    interval=1,
                    progress_tail=15,
                    max_turns=3,
                    max_wallclock=10,
                    once=True,
                    race_guard_seconds=0,
                    repo=repo,
                )

            self.assertEqual(result, 0)
            git_mock.assert_not_called()
            runtime = json.loads((repo / "autorun-status.json").read_text(encoding="utf-8"))
            self.assertFalse(runtime["running"])
            self.assertTrue(runtime["paused"])
            self.assertEqual(watch_handoff.read_frontmatter(repo / "handoff.md")["state"], "READY_FOR_DEV")

    def test_kill_switch_terminates_active_runner_without_forcing_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            pause = repo / "autorun.paused"

            def pause_soon():
                time.sleep(0.2)
                pause.write_text("pauze\n", encoding="utf-8")

            thread = threading.Thread(target=pause_soon)
            thread.start()
            started = time.monotonic()
            with self.assertRaisesRegex(watch_handoff.AutorunPaused, "kill-switch"):
                watch_handoff.act(
                    [sys.executable, "-c", "import time; time.sleep(30)"],
                    "context",
                    repo=repo,
                    timeout=10,
                    pause_path=pause,
                    poll_interval=0.05,
                )
            thread.join()

        self.assertLess(time.monotonic() - started, 5)

    def test_runner_timeout_terminates_process_tree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            started = time.monotonic()
            with self.assertRaisesRegex(watch_handoff.AutorunError, "wandklok"):
                watch_handoff.act(
                    [sys.executable, "-c", "import time; time.sleep(30)"],
                    "context",
                    repo=Path(directory),
                    timeout=0.2,
                    poll_interval=0.05,
                )
        self.assertLess(time.monotonic() - started, 5)

    def test_runner_timeout_terminates_child_process_too(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            marker = repo / "child-survived.txt"
            child = repo / "child.py"
            parent = repo / "parent.py"
            child.write_text(
                "import time\nfrom pathlib import Path\ntime.sleep(1)\n"
                f"Path({str(marker)!r}).write_text('survived', encoding='utf-8')\n",
                encoding="utf-8",
            )
            parent.write_text(
                "import subprocess, sys, time\n"
                f"subprocess.Popen([sys.executable, {str(child)!r}])\n"
                "time.sleep(30)\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(watch_handoff.AutorunError, "wandklok"):
                watch_handoff.act(
                    [sys.executable, str(parent)],
                    "context",
                    repo=repo,
                    timeout=0.2,
                    poll_interval=0.05,
                )
            time.sleep(1.2)
            self.assertFalse(marker.exists())

    def test_in_progress_turn_is_resumed_without_race_guard(self) -> None:
        in_progress = READY_HANDOFF.replace("READY_FOR_DEV", "DEV_IN_PROGRESS")
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory, in_progress)
            clean_pull = subprocess.CompletedProcess(["git"], 0, stdout="", stderr="")
            with (
                mock.patch.object(watch_handoff, "run_git", return_value=clean_pull),
                mock.patch.object(watch_handoff, "execute_autorun_turn", return_value="success") as execute,
                mock.patch.object(watch_handoff, "wait_for_race_guard") as guard,
            ):
                result = watch_handoff.run_session(
                    "codex",
                    autorun=True,
                    command=["runner"],
                    interval=1,
                    progress_tail=15,
                    max_turns=3,
                    max_wallclock=10,
                    once=True,
                    race_guard_seconds=60,
                    repo=repo,
                )

            self.assertEqual(result, 0)
            execute.assert_called_once()
            guard.assert_not_called()

    def test_loop_cap_blocks_before_a_second_turn(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            clean_pull = subprocess.CompletedProcess(["git"], 0, stdout="", stderr="")
            with (
                mock.patch.object(watch_handoff, "run_git", return_value=clean_pull),
                mock.patch.object(watch_handoff, "execute_autorun_turn", return_value="success") as execute,
                mock.patch.object(watch_handoff, "wait_for_race_guard", return_value=True),
                mock.patch.object(watch_handoff, "mark_blocked", return_value=True) as blocked,
                mock.patch.object(watch_handoff.time, "sleep", return_value=None),
            ):
                result = watch_handoff.run_session(
                    "codex",
                    autorun=True,
                    command=["runner"],
                    interval=1,
                    progress_tail=15,
                    max_turns=1,
                    max_wallclock=10,
                    once=False,
                    race_guard_seconds=0,
                    repo=repo,
                )

            self.assertEqual(result, 1)
            execute.assert_called_once()
            blocked.assert_called_once()
            self.assertIn("loop-cap van 1", blocked.call_args.args[1])

    def test_activity_log_is_single_line_and_excludes_multiline_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "autorun.log"
            watch_handoff.append_activity(
                "codex\nsecret-line", "READY", "DONE", "OK\nsecond", log_path=path
            )
            lines = path.read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(lines), 1)
        self.assertIn("codex secret-line · READY → DONE · OK second", lines[0])


if __name__ == "__main__":
    unittest.main()
