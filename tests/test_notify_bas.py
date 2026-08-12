from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock


REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "scripts"
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location("notify_bas", SCRIPTS / "notify_bas.py")
assert SPEC and SPEC.loader
notify_bas = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = notify_bas
SPEC.loader.exec_module(notify_bas)


def handoff_text(
    *,
    state: str = "READY_FOR_DEV",
    since: str = "2026-08-12T12:00:00Z",
    action_required_by: str = "none",
    note: str = "Werk ligt klaar.",
) -> str:
    return f'''---
sprint: 5
state: {state}
owner: codex
since: {since}
next: claude
action_required_by: {action_required_by}
blocked: false
note: "{note}"
---

# Handoff
'''


class NotifyBasTests(unittest.TestCase):
    def paths(self, directory: str, text: str) -> tuple[Path, Path]:
        handoff = Path(directory) / "handoff.md"
        state = Path(directory) / "notifier-state.json"
        handoff.write_text(text, encoding="utf-8")
        return handoff, state

    def test_each_exception_transition_is_sent_exactly_once(self) -> None:
        cases = (
            ("BLOCKED", "bas", "Er is een blokkade."),
            ("READY_FOR_DEV", "bas", "Start Deploy acceptatie."),
            ("SPRINT_DONE", "none", "Sprint is klaar."),
        )
        for state_name, action_owner, note in cases:
            with self.subTest(state=state_name), tempfile.TemporaryDirectory() as directory:
                handoff, state_file = self.paths(
                    directory,
                    handoff_text(
                        state=state_name,
                        action_required_by=action_owner,
                        note=note,
                    ),
                )
                delivered = []

                def fake_sender(config, notification):
                    delivered.append(notification)

                config = {"NOTIFIER_CHANNELS": "email"}
                first = notify_bas.notify_once(
                    handoff,
                    config,
                    state_file,
                    senders={"email": fake_sender},
                )
                second = notify_bas.notify_once(
                    handoff,
                    config,
                    state_file,
                    senders={"email": fake_sender},
                )

                self.assertEqual(len(delivered), 1)
                self.assertEqual(first.sent_channels, ("email",))
                self.assertTrue(second.duplicate)

    def test_same_state_with_new_since_is_a_new_transition(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            handoff, state_file = self.paths(
                directory,
                handoff_text(state="BLOCKED", action_required_by="bas"),
            )
            delivered = []
            senders = {"email": lambda config, notification: delivered.append(notification.since)}
            config = {"NOTIFIER_CHANNELS": "email"}

            notify_bas.notify_once(handoff, config, state_file, senders=senders)
            handoff.write_text(
                handoff_text(
                    state="BLOCKED",
                    since="2026-08-12T12:05:00Z",
                    action_required_by="bas",
                ),
                encoding="utf-8",
            )
            notify_bas.notify_once(handoff, config, state_file, senders=senders)

            self.assertEqual(delivered, ["2026-08-12T12:00:00Z", "2026-08-12T12:05:00Z"])

    def test_normal_transition_sends_nothing_and_writes_no_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            handoff, state_file = self.paths(directory, handoff_text())
            result = notify_bas.notify_once(
                handoff,
                {"NOTIFIER_CHANNELS": "email"},
                state_file,
                senders={"email": lambda config, notification: self.fail("unexpected send")},
            )

            self.assertFalse(result.triggered)
            self.assertFalse(state_file.exists())

    def test_successful_channel_is_not_repeated_if_later_channel_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            handoff, state_file = self.paths(
                directory,
                handoff_text(state="BLOCKED", action_required_by="bas"),
            )
            calls = []

            def email(config, notification):
                calls.append("email")

            def failing_push(config, notification):
                calls.append("ntfy-fail")
                raise notify_bas.NotifierError("push tijdelijk niet beschikbaar")

            config = {"NOTIFIER_CHANNELS": "email,ntfy"}
            with self.assertRaises(notify_bas.NotifierError):
                notify_bas.notify_once(
                    handoff,
                    config,
                    state_file,
                    senders={"email": email, "ntfy": failing_push},
                )

            notify_bas.notify_once(
                handoff,
                config,
                state_file,
                senders={"email": email, "ntfy": lambda config, notification: calls.append("ntfy")},
            )

            self.assertEqual(calls, ["email", "ntfy-fail", "ntfy"])
            saved = json.loads(state_file.read_text(encoding="utf-8"))
            self.assertEqual(saved["sent_channels"], ["email", "ntfy"])

    def test_corrupt_state_fails_closed_to_prevent_duplicate_spam(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            handoff, state_file = self.paths(
                directory,
                handoff_text(state="BLOCKED", action_required_by="bas"),
            )
            state_file.write_text("not-json", encoding="utf-8")

            with self.assertRaisesRegex(notify_bas.NotifierError, "spam"):
                notify_bas.notify_once(handoff, {"NOTIFIER_CHANNELS": "email"}, state_file)

    def test_email_is_the_default_channel(self) -> None:
        self.assertEqual(notify_bas.configured_channels({}), ("email",))

    def test_message_contains_state_note_and_direct_acceptance_instruction(self) -> None:
        notification = notify_bas.notification_for(
            {
                "state": "READY_FOR_DEV",
                "since": "2026-08-12T12:00:00Z",
                "action_required_by": "bas",
                "note": "Start nu Deploy acceptatie.",
            },
            "https://github.invalid/actions",
        )

        self.assertIsNotNone(notification)
        assert notification
        self.assertIn("READY_FOR_DEV", notification.body)
        self.assertIn("Start nu Deploy acceptatie.", notification.body)
        self.assertIn("Open GitHub Actions en start Deploy acceptatie.", notification.body)
        self.assertIn("https://github.invalid/actions", notification.body)

    def test_config_parser_accepts_bom_crlf_quotes_and_export(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "notifier.env"
            path.write_text(
                "# lokaal\r\nexport NOTIFIER_CHANNELS='email,ntfy'\r\nSMTP_PORT=\"587\"\r\n",
                encoding="utf-8-sig",
            )

            config = notify_bas.parse_env_file(path)

        self.assertEqual(config["NOTIFIER_CHANNELS"], "email,ntfy")
        self.assertEqual(config["SMTP_PORT"], "587")

    def test_config_parser_strips_unquoted_comments_and_preserves_quoted_hash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "notifier.env"
            path.write_text(
                "SMTP_PORT = 587 # lokale poort\n"
                "SMTP_PASSWORD=\"P#ssword\" # blijft lokaal\n"
                "NTFY_TOPIC=topic#onderdeel\n",
                encoding="utf-8",
            )

            config = notify_bas.parse_env_file(path)

        self.assertEqual(config["SMTP_PORT"], "587")
        self.assertEqual(config["SMTP_PASSWORD"], "P#ssword")
        self.assertEqual(config["NTFY_TOPIC"], "topic#onderdeel")

    def test_concurrent_process_equivalents_send_one_message(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            handoff, state_file = self.paths(
                directory,
                handoff_text(state="BLOCKED", action_required_by="bas"),
            )
            delivered = []
            barrier = threading.Barrier(2)

            def fake_sender(config, notification):
                delivered.append(notification.since)
                time.sleep(0.1)

            def run_once():
                barrier.wait()
                return notify_bas.notify_once(
                    handoff,
                    {"NOTIFIER_CHANNELS": "email"},
                    state_file,
                    senders={"email": fake_sender},
                )

            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda unused: run_once(), range(2)))

            self.assertEqual(delivered, ["2026-08-12T12:00:00Z"])
            self.assertEqual(sum(result.duplicate for result in results), 1)

    @mock.patch.object(notify_bas.smtplib, "SMTP")
    def test_email_adapter_uses_starttls_and_authentication(self, smtp_factory) -> None:
        client = smtp_factory.return_value.__enter__.return_value
        notification = notify_bas.Notification(
            "BLOCKED", "2026-08-12T12:00:00Z", "Blokkade", "Open handoff.", "Actie", "Bericht"
        )

        notify_bas.send_email(
            {
                "SMTP_HOST": "smtp.invalid",
                "SMTP_PORT": "587",
                "SMTP_SECURITY": "starttls",
                "SMTP_USERNAME": "local-user",
                "SMTP_PASSWORD": "local-secret",
                "SMTP_FROM": "from-address",
                "SMTP_TO": "to-address",
            },
            notification,
        )

        client.starttls.assert_called_once()
        client.login.assert_called_once_with("local-user", "local-secret")
        client.send_message.assert_called_once()

    @mock.patch.object(notify_bas.urllib.request, "urlopen")
    def test_ntfy_adapter_uses_https_bearer_and_encoded_topic(self, urlopen) -> None:
        response = urlopen.return_value.__enter__.return_value
        response.status = 200
        notification = notify_bas.Notification(
            "BLOCKED", "2026-08-12T12:00:00Z", "Blokkade", "Open handoff.", "Actie", "Bericht"
        )

        notify_bas.send_ntfy(
            {
                "NTFY_URL": "https://push.invalid",
                "NTFY_TOPIC": "alv lokaal",
                "NTFY_TOKEN": "local-token",
            },
            notification,
        )

        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://push.invalid/alv%20lokaal")
        self.assertEqual(request.get_header("Authorization"), "Bearer local-token")

    def test_cli_needs_no_config_when_there_is_no_trigger(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            handoff, state_file = self.paths(directory, handoff_text())
            exit_code = notify_bas.main(
                [
                    "--handoff",
                    str(handoff),
                    "--config",
                    str(Path(directory) / "does-not-exist.env"),
                    "--state-file",
                    str(state_file),
                ]
            )

        self.assertEqual(exit_code, 0)

    def test_cli_activity_log_records_dry_run_without_secret_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            handoff, state_file = self.paths(
                directory,
                handoff_text(state="BLOCKED", action_required_by="bas"),
            )
            config = Path(directory) / "notifier.env"
            activity = Path(directory) / "autorun.log"
            config.write_text("NOTIFIER_CHANNELS=email\n", encoding="utf-8")
            exit_code = notify_bas.main(
                [
                    "--handoff",
                    str(handoff),
                    "--config",
                    str(config),
                    "--state-file",
                    str(state_file),
                    "--activity-log",
                    str(activity),
                    "--dry-run",
                ]
            )

            logged = activity.read_text(encoding="utf-8")

        self.assertEqual(exit_code, 0)
        self.assertIn("notifier · BLOCKED → BLOCKED · DRY-RUN", logged)
        self.assertNotIn("NOTIFIER_CHANNELS", logged)


if __name__ == "__main__":
    unittest.main()
