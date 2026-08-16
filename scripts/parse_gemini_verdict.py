#!/usr/bin/env python3
"""Parse Gemini's final verdict line and fail closed to REQUEST_CHANGES."""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path


VERDICT_LINE = re.compile(r"^VERDICT: (APPROVE|REQUEST_CHANGES)$")


@dataclass(frozen=True)
class Verdict:
    event: str
    valid: bool
    reason: str


def parse_verdict(review_text: str) -> Verdict:
    """Approve only one exact verdict trailer on the final non-empty line."""
    lines = review_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    non_empty = [line for line in lines if line.strip()]
    verdicts = [match.group(1) for line in lines if (match := VERDICT_LINE.fullmatch(line))]

    if len(verdicts) != 1:
        return Verdict("REQUEST_CHANGES", False, "verdict ontbreekt of is dubbelzinnig")
    if not non_empty or VERDICT_LINE.fullmatch(non_empty[-1]) is None:
        return Verdict("REQUEST_CHANGES", False, "verdict staat niet op de laatste regel")
    return Verdict(verdicts[0], True, "geldige verdict-trailer")


def _write_github_output(path: Path, verdict: Verdict) -> None:
    safe_reason = " ".join(verdict.reason.splitlines())
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"event={verdict.event}\n")
        handle.write(f"valid={str(verdict.valid).lower()}\n")
        handle.write(f"reason={safe_reason}\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("review_file", type=Path)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args(argv)

    try:
        review_text = args.review_file.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        review_text = ""
    verdict = parse_verdict(review_text)
    if args.github_output:
        _write_github_output(args.github_output, verdict)
    print(verdict.event)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
