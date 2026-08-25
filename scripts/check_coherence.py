#!/usr/bin/env python3
"""Validate sprint identity in activation, feature-work, or PR-CI context.

Raakt: ADR-0026, ADR-0025, pipeline_guard.py, git_steward.py en ci.yml.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from pipeline_guard import PipelineGuardError, SprintMetadata, load_sprint_metadata


class CoherenceError(RuntimeError):
    """A concrete, fail-closed identity error."""


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True,
        encoding="utf-8", errors="replace", check=False,
    )
    if result.returncode:
        detail = " ".join((result.stderr or result.stdout or "git-fout").splitlines())[:200]
        raise CoherenceError(f"git-observatie faalde: {detail}")
    return result.stdout.strip()


def validate_coherence(
    metadata: SprintMetadata,
    *,
    mode: str,
    current_branch: str,
    head_sha: str,
    pr_head: str | None = None,
    pr_head_sha: str | None = None,
) -> dict[str, object]:
    errors: list[str] = []
    if mode == "activation":
        if current_branch != "main":
            errors.append(f"activatie moet op main draaien, niet op {current_branch or 'detached HEAD'}")
        if head_sha.lower() != metadata.base_sha:
            errors.append("activatie-base-SHA is niet exact de verse main-HEAD")
    elif mode == "feature":
        if current_branch != metadata.branch:
            errors.append(
                f"featurewerk draait op {current_branch or 'detached HEAD'}, verwacht {metadata.branch}"
            )
        if head_sha.lower() == metadata.base_sha:
            # The first feature commit may equal the base; this is coherent and intentional.
            pass
    elif mode == "pr-ci":
        if pr_head != metadata.branch:
            errors.append(f"PR-head {pr_head or '<ontbreekt>'} wijkt af van {metadata.branch}")
        if pr_head_sha is None or head_sha.lower() != pr_head_sha.lower():
            errors.append("checkout-SHA wijkt af van de exacte PR-head-SHA")
    else:
        errors.append(f"onbekende coherentie-modus: {mode}")
    if errors:
        raise CoherenceError("; ".join(errors))
    return {
        "decision": "ok",
        "mode": mode,
        "sprint": metadata.sprint,
        "branch": metadata.branch,
        "head_sha": head_sha.lower(),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("activation", "feature", "pr-ci"))
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--pr-head")
    parser.add_argument("--pr-head-sha")
    args = parser.parse_args(argv)
    try:
        metadata = load_sprint_metadata(args.metadata)
        current_branch = _git(args.repo, "branch", "--show-current")
        head_sha = _git(args.repo, "rev-parse", "HEAD")
        result = validate_coherence(
            metadata,
            mode=args.mode,
            current_branch=current_branch,
            head_sha=head_sha,
            pr_head=args.pr_head,
            pr_head_sha=args.pr_head_sha,
        )
        if args.mode == "activation":
            _git(args.repo, "cat-file", "-e", f"{metadata.base_sha}^{{commit}}")
    except (PipelineGuardError, CoherenceError) as exc:
        print(f"COHERENCE_BLOCKED: {exc}", file=sys.stderr)
        return 2
    print(
        f"COHERENCE_OK: mode={result['mode']} sprint={result['sprint']} "
        f"branch={result['branch']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
