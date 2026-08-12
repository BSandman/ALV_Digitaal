from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
SPEC = importlib.util.spec_from_file_location("autorun_io", REPO / "scripts" / "autorun_io.py")
assert SPEC and SPEC.loader
autorun_io = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = autorun_io
SPEC.loader.exec_module(autorun_io)


class AutorunIOTests(unittest.TestCase):
    def test_concurrent_watcher_and_notifier_appends_remain_complete(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "autorun.log"

            def write(number: int) -> None:
                role = "notifier" if number % 2 else "codex"
                autorun_io.append_activity(
                    role,
                    "READY",
                    "DONE",
                    f"regel-{number:03d}",
                    log_path=log,
                )

            with ThreadPoolExecutor(max_workers=12) as pool:
                list(pool.map(write, range(100)))
            lines = log.read_text(encoding="utf-8").splitlines()

        self.assertEqual(len(lines), 100)
        for number in range(100):
            self.assertEqual(sum(f"regel-{number:03d}" in line for line in lines), 1)
        self.assertTrue(all(line.count(" · ") == 3 for line in lines))


if __name__ == "__main__":
    unittest.main()
