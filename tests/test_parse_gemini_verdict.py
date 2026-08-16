from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "parse_gemini_verdict", REPO / "scripts" / "parse_gemini_verdict.py"
)
assert SPEC and SPEC.loader
parse_gemini_verdict = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = parse_gemini_verdict
SPEC.loader.exec_module(parse_gemini_verdict)


class ParseGeminiVerdictTests(unittest.TestCase):
    def test_exact_final_approve_is_accepted(self) -> None:
        result = parse_gemini_verdict.parse_verdict("Alles groen.\nVERDICT: APPROVE\n")
        self.assertTrue(result.valid)
        self.assertEqual(result.event, "APPROVE")

    def test_exact_final_request_changes_is_accepted(self) -> None:
        result = parse_gemini_verdict.parse_verdict(
            "Raceconditie moet worden opgelost.\r\nVERDICT: REQUEST_CHANGES\r\n"
        )
        self.assertTrue(result.valid)
        self.assertEqual(result.event, "REQUEST_CHANGES")

    def test_missing_ambiguous_or_non_final_verdict_fails_closed(self) -> None:
        samples = [
            "Geen trailer",
            "VERDICT: APPROVE\nVERDICT: REQUEST_CHANGES",
            "VERDICT: APPROVE\nTekst erna",
            "verdict: approve",
            "VERDICT: APPROVE ",
        ]
        for review_text in samples:
            with self.subTest(review_text=review_text):
                result = parse_gemini_verdict.parse_verdict(review_text)
                self.assertFalse(result.valid)
                self.assertEqual(result.event, "REQUEST_CHANGES")

    def test_cli_output_is_constrained_and_machine_readable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            review = root / "review.txt"
            output = root / "github-output.txt"
            review.write_text("Gereed.\nVERDICT: APPROVE", encoding="utf-8")
            self.assertEqual(
                parse_gemini_verdict.main(
                    [str(review), "--github-output", str(output)]
                ),
                0,
            )
            self.assertEqual(
                output.read_text(encoding="utf-8"),
                "event=APPROVE\nvalid=true\nreason=geldige verdict-trailer\n",
            )


if __name__ == "__main__":
    unittest.main()
