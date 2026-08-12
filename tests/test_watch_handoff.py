from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "watch_handoff", REPO / "scripts" / "watch_handoff.py"
)
assert SPEC and SPEC.loader
watch_handoff = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(watch_handoff)


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


if __name__ == "__main__":
    unittest.main()
