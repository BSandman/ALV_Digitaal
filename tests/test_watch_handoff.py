from __future__ import annotations

import importlib.util
import json
import shutil
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
READY_FOR_TEST_HANDOFF = READY_HANDOFF.replace("READY_FOR_DEV", "READY_FOR_TEST").replace(
    "owner: codex", "owner: gemini"
)


class WatchHandoffContextTests(unittest.TestCase):
    def make_repo(self, directory: str) -> Path:
        repo = Path(directory)
        (repo / "docs" / "gates").mkdir(parents=True)
        (repo / "handoff.md").write_text("HANDOFF-HELEMAAL\nregel-2\n", encoding="utf-8")
        (repo / "sprint.md").write_text(
            "SPRINT-HELEMAAL `docs/gates/Codex-taak-gitsteward-stap2.md`\n",
            encoding="utf-8",
        )
        (repo / "bijbel.md").write_text(
            "# BIJBEL-HELEMAAL\n\n"
            "## 1. Product\nALLEEN-IN-VOLLEDIGE-BIJBEL\n\n"
            "## 2. Rollen\nROLLEN-BEREIKBAAR\n\n"
            "## 3. Techniek\nTECHNIEK-OP-AFROEP\n\n"
            "## 8. Versiebeheer\nVERSIEBEHEER-BEREIKBAAR\n\n"
            "## 9. ADR-register\nADR-REGISTER-BEREIKBAAR\n\n"
            "## 10. Sleuteldocumenten\nLAATSTE-BIJBELREGEL\n",
            encoding="utf-8",
        )
        (repo / "docs" / "gates" / "Codex-instructie.md").write_text(
            "CODEX-CHARTER\n", encoding="utf-8"
        )
        (repo / "docs" / "gates" / "Codex-taak-gitsteward-stap2.md").write_text(
            "CODEX-TAAKDOC\n", encoding="utf-8"
        )
        (repo / "docs" / "gates" / "Mistral-instructie.md").write_text(
            "MISTRAL-TAAKDOC\n", encoding="utf-8"
        )
        (repo / "progress.md").write_text(
            "\n".join(f"progress-{number:02d}" for number in range(1, 21)) + "\n",
            encoding="utf-8",
        )
        return repo

    def test_codex_context_contains_trimmed_bible_task_docs_and_progress_tail(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            context = watch_handoff.build_context("codex", repo=self.make_repo(directory))

        self.assertIn("HANDOFF-HELEMAAL\nregel-2", context)
        self.assertIn("SPRINT-HELEMAAL", context)
        self.assertNotIn("ALLEEN-IN-VOLLEDIGE-BIJBEL", context)
        self.assertNotIn("TECHNIEK-OP-AFROEP", context)
        self.assertIn("ROLLEN-BEREIKBAAR", context)
        self.assertIn("VERSIEBEHEER-BEREIKBAAR", context)
        self.assertIn("ADR-REGISTER-BEREIKBAAR", context)
        self.assertIn("CODEX-CHARTER", context)
        self.assertIn("CODEX-TAAKDOC", context)
        self.assertIn("progress.md (laatste 15 regels)", context)
        self.assertNotIn("progress-05", context)
        self.assertIn("progress-06", context)
        self.assertIn("progress-20", context)

    def test_claude_defaults_to_full_bible_and_override_is_knobbed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            claude = watch_handoff.build_context("claude", repo=repo)
            codex_full = watch_handoff.build_context("codex", repo=repo, bijbel_mode="full")

        self.assertIn("bijbel.md (volledig)", claude)
        self.assertIn("ALLEEN-IN-VOLLEDIGE-BIJBEL", claude)
        self.assertIn("ALLEEN-IN-VOLLEDIGE-BIJBEL", codex_full)

    def test_mistral_context_uses_register_and_its_own_task_doc(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            context = watch_handoff.build_context("mistral", repo=self.make_repo(directory))

        self.assertNotIn("ALLEEN-IN-VOLLEDIGE-BIJBEL", context)
        self.assertIn("ADR-REGISTER-BEREIKBAAR", context)
        self.assertIn("MISTRAL-TAAKDOC", context)
        self.assertNotIn("CODEX-TAAKDOC", context)

    def test_progress_tail_is_configurable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            context = watch_handoff.build_context(
                "codex", progress_tail=3, repo=self.make_repo(directory)
            )

        self.assertNotIn("progress-17", context)
        self.assertIn("progress-18", context)
        self.assertIn("progress-19", context)
        self.assertIn("progress-20", context)

    def test_progress_shorter_than_tail_is_included_completely(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            (repo / "progress.md").write_text("eerste\ntweede\n", encoding="utf-8")
            context = watch_handoff.build_context("codex", progress_tail=15, repo=repo)

        self.assertIn("eerste\ntweede", context)

    def test_non_positive_tail_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            with self.assertRaisesRegex(ValueError, "minimaal 1"):
                watch_handoff.build_context("codex", progress_tail=0, repo=repo)

    def test_utf8_bom_is_not_forwarded_into_context(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            original = (repo / "bijbel.md").read_text(encoding="utf-8")
            (repo / "bijbel.md").write_text(original, encoding="utf-8-sig")
            context = watch_handoff.build_context("claude", repo=repo)

        self.assertIn("BIJBEL-HELEMAAL", context)
        self.assertNotIn("\ufeff", context)

    def test_runner_prompt_does_not_repeat_the_watcher_race_guard(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            context = watch_handoff.build_runner_input("codex", repo=self.make_repo(directory))

        self.assertIn("watcher heeft de race-guard al voltooid", context)
        self.assertNotIn("wacht 60", context.lower())


class WatchHandoffAutorunTests(unittest.TestCase):
    def make_repo(self, directory: str, handoff: str = READY_HANDOFF) -> Path:
        repo = Path(directory)
        (repo / "scripts").mkdir()
        (repo / "docs" / "gates").mkdir(parents=True)
        (repo / "handoff.md").write_text(handoff, encoding="utf-8")
        (repo / "sprint.md").write_text(
            "SPRINT `docs/gates/Codex-taak-gitsteward-stap2.md`\n", encoding="utf-8"
        )
        (repo / "bijbel.md").write_text(
            "## 2. Rollen\nROLLEN\n\n## 8. Versiebeheer\nVERSIES\n\n"
            "## 9. ADR-register\nREGISTER\n",
            encoding="utf-8",
        )
        (repo / "docs" / "gates" / "Codex-instructie.md").write_text(
            "CHARTER\n", encoding="utf-8"
        )
        (repo / "docs" / "gates" / "Codex-taak-gitsteward-stap2.md").write_text(
            "TAAK\n", encoding="utf-8"
        )
        (repo / "progress.md").write_text("PROGRESS\n", encoding="utf-8")
        return repo

    @staticmethod
    def clean_git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
        stdout = "0\t0\n" if args[:3] == ("rev-list", "--left-right", "--count") else ""
        return subprocess.CompletedProcess(["git", *args], 0, stdout=stdout, stderr="")

    @staticmethod
    def fixture_git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            ["git", *args], cwd=repo, capture_output=True, text=True, check=False
        )
        if result.returncode != 0:
            raise AssertionError(f"git {' '.join(args)} faalde: {result.stderr}")
        return result

    def test_attended_single_turn_uses_real_steward_and_exits_clean_in_sync(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = root / "remote.git"
            seed = root / "seed"
            work = root / "work"
            self.fixture_git(root, "init", "--bare", str(remote))
            self.fixture_git(root, "init", "-b", "main", str(seed))
            self.fixture_git(seed, "config", "user.name", "Fixture")
            self.fixture_git(seed, "config", "user.email", "fixture@example.invalid")
            (seed / "scripts").mkdir()
            (seed / "docs" / "gates").mkdir(parents=True)
            for name in ("git_steward.py", "lint_handoff.py", "notify_bas.py", "autorun_io.py"):
                shutil.copy2(REPO / "scripts" / name, seed / "scripts" / name)
            (seed / ".gitignore").write_text(
                "autorun-status.json\nautorun.log\nautorun.paused\n__pycache__/\n*.pyc\n",
                encoding="utf-8",
            )
            (seed / "handoff.md").write_text(READY_HANDOFF, encoding="utf-8")
            (seed / "progress.md").write_text("# Progress\n", encoding="utf-8")
            (seed / "sprint.md").write_text(
                "Sprint `docs/gates/Codex-taak-gitsteward-stap2.md`\n", encoding="utf-8"
            )
            (seed / "bijbel.md").write_text(
                "## 2. Rollen\nROLLEN\n\n## 8. Versiebeheer\nVERSIES\n\n"
                "## 9. ADR-register\nREGISTER\n",
                encoding="utf-8",
            )
            (seed / "docs" / "gates" / "Codex-instructie.md").write_text(
                "CHARTER\n", encoding="utf-8"
            )
            (seed / "docs" / "gates" / "Codex-taak-gitsteward-stap2.md").write_text(
                "TAAK\n", encoding="utf-8"
            )
            self.fixture_git(
                seed,
                "add",
                "--",
                ".gitignore",
                "scripts",
                "docs",
                "handoff.md",
                "progress.md",
                "sprint.md",
                "bijbel.md",
            )
            self.fixture_git(seed, "commit", "-m", "seed")
            self.fixture_git(seed, "remote", "add", "origin", str(remote))
            self.fixture_git(seed, "push", "-u", "origin", "main")
            self.fixture_git(remote, "symbolic-ref", "HEAD", "refs/heads/main")
            self.fixture_git(root, "clone", "--quiet", str(remote), str(work))
            self.fixture_git(work, "config", "user.name", "Fixture")
            self.fixture_git(work, "config", "user.email", "fixture@example.invalid")
            self.fixture_git(work, "switch", "-c", "agent/attended-proof")
            self.fixture_git(work, "push", "-u", "origin", "agent/attended-proof")

            runner = root / "runner.py"
            runner.write_text(
                "from pathlib import Path\n"
                "import subprocess\n"
                f"Path('handoff.md').write_text({READY_FOR_TEST_HANDOFF!r}, encoding='utf-8')\n"
                "with Path('progress.md').open('a', encoding='utf-8') as handle:\n"
                "    handle.write('- attended watcher proof\\n')\n"
                "subprocess.run(['git', 'add', '--', 'handoff.md', 'progress.md'], check=True)\n"
                "subprocess.run(['git', 'commit', '-m', 'test: complete attended turn'], check=True)\n"
                "subprocess.run(['git', 'push'], check=True)\n",
                encoding="utf-8",
            )

            result = watch_handoff.run_session(
                "codex",
                autorun=True,
                command=[sys.executable, str(runner)],
                interval=1,
                progress_tail=15,
                max_turns=1,
                max_wallclock=30,
                once=False,
                race_guard_seconds=0,
                repo=work,
            )

            runtime = json.loads((work / "autorun-status.json").read_text(encoding="utf-8"))
            remote_handoff = self.fixture_git(remote, "show", "main:handoff.md").stdout
            self.assertEqual(result, 0)
            self.assertIn("state: READY_FOR_TEST", remote_handoff)
            self.assertFalse(runtime["running"])
            self.assertEqual(self.fixture_git(work, "status", "--porcelain").stdout, "")
            self.assertEqual(
                self.fixture_git(work, "rev-list", "--left-right", "--count", "HEAD...@{u}").stdout.strip(),
                "0\t0",
            )

    def test_local_environment_can_set_bounded_defaults(self) -> None:
        defaults = watch_handoff.load_autorun_defaults(
            {
                "ALV_AUTORUN_INTERVAL_SECONDS": "30",
                "ALV_AUTORUN_PROGRESS_TAIL": "12",
                "ALV_AUTORUN_MAX_TURNS": "1",
                "ALV_AUTORUN_MAX_WALLCLOCK_SECONDS": "900",
            }
        )
        self.assertEqual(
            defaults,
            {
                "interval": 30,
                "progress_tail": 12,
                "max_turns": 1,
                "max_wallclock": 900,
            },
        )

    def test_invalid_environment_default_is_rejected(self) -> None:
        with self.assertRaisesRegex(watch_handoff.AutorunError, "minimaal 1"):
            watch_handoff.load_autorun_defaults({"ALV_AUTORUN_MAX_TURNS": "0"})
        with self.assertRaisesRegex(watch_handoff.AutorunError, "uitsluitend cijfers"):
            watch_handoff.load_autorun_defaults(
                {"ALV_AUTORUN_MAX_WALLCLOCK_SECONDS": "kwartier"}
            )

    def test_environment_defaults_strip_whitespace_and_empty_uses_fallback(self) -> None:
        defaults = watch_handoff.load_autorun_defaults(
            {
                "ALV_AUTORUN_INTERVAL_SECONDS": "  45  ",
                "ALV_AUTORUN_MAX_TURNS": "",
            }
        )
        self.assertEqual(defaults["interval"], 45)
        self.assertEqual(defaults["max_turns"], watch_handoff.DEFAULT_MAX_TURNS)

    def test_signed_and_extreme_environment_defaults_are_rejected(self) -> None:
        with self.assertRaisesRegex(watch_handoff.AutorunError, "uitsluitend cijfers"):
            watch_handoff.load_autorun_defaults({"ALV_AUTORUN_MAX_TURNS": "+10"})
        with self.assertRaisesRegex(watch_handoff.AutorunError, "maximaal"):
            watch_handoff.load_autorun_defaults(
                {"ALV_AUTORUN_MAX_WALLCLOCK_SECONDS": "999999999999"}
            )

    def test_cli_value_overrides_environment_default(self) -> None:
        with (
            mock.patch.dict(
                watch_handoff.os.environ,
                {"ALV_AUTORUN_MAX_TURNS": "1"},
                clear=True,
            ),
            mock.patch.object(
                watch_handoff, "load_runner_command", return_value=["runner"]
            ),
            mock.patch.object(watch_handoff, "run_session", return_value=0) as run_session,
        ):
            exit_code = watch_handoff.main(
                ["--role", "codex", "--autorun", "--max-turns", "5", "--once"]
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(run_session.call_args.kwargs["max_turns"], 5)

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
            steward_calls = []

            def fake_act(command, context, *, repo, timeout, pause_path=None):
                self.assertIn("§9 ADR-register", context)
                self.assertNotIn("bijbel.md (volledig)", context)
                self.assertIn("Voer exact één handoff-beurt uit als rol codex", context)
                self.assertIn("race-guard al voltooid", context)
                self.assertIn("Voer nooit zelf een deploy uit", context)
                (repo / "handoff.md").write_text(VALIDATED_HANDOFF, encoding="utf-8")
                return subprocess.CompletedProcess(command, 0)

            def fake_steward(current_repo, *args):
                steward_calls.append(args)
                return subprocess.CompletedProcess(["git_steward", *args], 0, stdout="", stderr="")

            with mock.patch.object(watch_handoff, "act", side_effect=fake_act):
                result = watch_handoff.execute_autorun_turn(
                    "codex",
                    ["runner"],
                    progress_tail=15,
                    deadline=watch_handoff.time.monotonic() + 10,
                    repo=repo,
                    git_runner=self.clean_git,
                    steward_runner=fake_steward,
                    notifier_runner=lambda current_repo: notifications.append(current_repo) or 0,
                    log_path=repo / "autorun.log",
                )

            self.assertEqual(result, "success")
            self.assertEqual(steward_calls, [("sync",)])
            self.assertEqual(notifications, [repo])
            log = (repo / "autorun.log").read_text(encoding="utf-8")
            self.assertIn("READY_FOR_DEV → READY_FOR_VALIDATION · OK", log)

    def test_nonzero_runner_block_finalizes_via_steward_then_notifies(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            git_calls = []
            steward_calls = []
            notifications = []

            def fake_git(current_repo, *args):
                git_calls.append(args)
                return subprocess.CompletedProcess(["git", *args], 0, stdout="", stderr="")

            def fake_steward(current_repo, *args):
                steward_calls.append(args)
                values = {
                    "state": "BLOCKED",
                    "owner": "bas",
                    "next": "none",
                    "action_required_by": "bas",
                    "blocked": "true",
                    "note": args[-1],
                }
                text = (current_repo / "handoff.md").read_text(encoding="utf-8")
                (current_repo / "handoff.md").write_text(
                    watch_handoff._frontmatter_with_updates(text, values), encoding="utf-8"
                )
                return subprocess.CompletedProcess(["git_steward", *args], 0, stdout="", stderr="")

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
                    steward_runner=fake_steward,
                    notifier_runner=lambda current_repo: notifications.append(current_repo) or 0,
                    log_path=repo / "autorun.log",
                )

            self.assertEqual(result, "failed")
            blocked = watch_handoff.read_frontmatter(repo / "handoff.md")
            self.assertEqual(blocked["state"], "BLOCKED")
            self.assertEqual(blocked["owner"], "bas")
            self.assertEqual(blocked["action_required_by"], "bas")
            self.assertEqual(blocked["blocked"], "true")
            self.assertEqual(git_calls, [])
            self.assertEqual(steward_calls[0][0], "block_finalize")
            self.assertIn("--role", steward_calls[0])
            self.assertEqual(notifications, [repo])

    def test_failed_coordination_sync_is_block_finalized_via_steward(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.make_repo(directory)
            steward_calls = []

            def fake_act(command, context, *, repo, timeout, pause_path=None):
                (repo / "handoff.md").write_text(VALIDATED_HANDOFF, encoding="utf-8")
                return subprocess.CompletedProcess(command, 0)

            def fake_steward(current_repo, *args):
                steward_calls.append(args)
                return subprocess.CompletedProcess(
                    ["git_steward", *args], 1 if args[0] == "sync" else 0, stdout="", stderr=""
                )

            with mock.patch.object(watch_handoff, "act", side_effect=fake_act):
                result = watch_handoff.execute_autorun_turn(
                    "codex",
                    ["runner"],
                    progress_tail=15,
                    deadline=watch_handoff.time.monotonic() + 10,
                    repo=repo,
                    git_runner=self.clean_git,
                    steward_runner=fake_steward,
                    notifier_runner=lambda current_repo: 0,
                    log_path=repo / "autorun.log",
                )

        self.assertEqual(result, "failed")
        self.assertEqual(steward_calls[0], ("sync",))
        self.assertEqual(steward_calls[1][0], "block_finalize")

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

    def test_max_turns_exits_cleanly_without_after_idle_or_block(self) -> None:
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

            self.assertEqual(result, 0)
            execute.assert_called_once()
            blocked.assert_not_called()
            runtime = json.loads((repo / "autorun-status.json").read_text(encoding="utf-8"))
            self.assertFalse(runtime["running"])
            self.assertEqual(runtime["turns"], 1)

    def test_activity_log_is_single_line_and_excludes_multiline_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "autorun.log"
            watch_handoff.append_activity(
                "codex\nsecret-line", "READY", "DONE", "OK\nsecond", log_path=path
            )
            lines = path.read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(lines), 1)
        self.assertIn("codex secret-line · READY → DONE · OK second", lines[0])

    def test_failed_atomic_write_keeps_original_file_intact(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "handoff.md"
            path.write_text("ORIGINEEL\n", encoding="utf-8")
            with mock.patch.object(
                watch_handoff.tempfile,
                "NamedTemporaryFile",
                side_effect=OSError("schijf vol"),
            ):
                with self.assertRaisesRegex(watch_handoff.AutorunError, "atomair"):
                    watch_handoff._write_text_atomic(path, "NIEUW\n")
            self.assertEqual(path.read_text(encoding="utf-8"), "ORIGINEEL\n")


if __name__ == "__main__":
    unittest.main()
