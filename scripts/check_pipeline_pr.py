#!/usr/bin/env python3
"""Fail-closed evaluator for a pipeline PR returned by ``gh pr view``."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping


REQUIRED_CHECKS = {
    "Handoff state guardrail": "T-run architecture and privacy gates",
    "gates": "T-run architecture and privacy gates",
    "review": "Gemini Lead Tester Review",
}
EXPECTED_REVIEWER = "github-actions"


@dataclass(frozen=True)
class Evaluation:
    decision: str
    reason: str
    head_sha: str = ""


def _repository_name(pr: Mapping[str, Any]) -> str:
    repository = pr.get("headRepository") or {}
    if isinstance(repository, Mapping) and repository.get("nameWithOwner"):
        return str(repository["nameWithOwner"])
    owner = pr.get("headRepositoryOwner") or {}
    name = repository.get("name") if isinstance(repository, Mapping) else ""
    login = owner.get("login") if isinstance(owner, Mapping) else ""
    return f"{login}/{name}" if login and name else ""


def _review_author(review: Mapping[str, Any]) -> str:
    author = review.get("author") or {}
    if not isinstance(author, Mapping):
        return ""
    return str(author.get("login", ""))


def _normalize_reviewer_login(login: str) -> str:
    """Normalize GitHub's GraphQL and REST spellings for bot logins."""
    normalized = login.casefold()
    bot_suffix = "[bot]"
    if normalized.endswith(bot_suffix):
        normalized = normalized[: -len(bot_suffix)]
    return normalized


def evaluate_pr(pr: Mapping[str, Any], *, repository: str) -> Evaluation:
    """Return merge/advance/noop and never infer safety from missing data."""
    try:
        state = str(pr["state"])
        head_ref = str(pr["headRefName"])
        head_sha = str(pr["headRefOid"])
        base_ref = str(pr["baseRefName"])
    except (KeyError, TypeError, ValueError):
        return Evaluation("noop", "verplichte PR-metadata ontbreekt")

    if not re.fullmatch(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})", head_sha):
        return Evaluation("noop", "ongeldige of ontbrekende head-SHA")

    if _repository_name(pr).casefold() != repository.casefold():
        return Evaluation("noop", "fork of onbekende head-repository geweigerd", head_sha)
    if base_ref != "main":
        return Evaluation("noop", "base is niet main", head_sha)

    labels = {
        str(label.get("name", "")).casefold()
        for label in pr.get("labels", [])
        if isinstance(label, Mapping)
    }
    if not head_ref.startswith("agent/") and "pipeline" not in labels:
        return Evaluation("noop", "geen pipelinebranch of pipeline-label", head_sha)
    if bool(pr.get("isDraft")):
        return Evaluation("noop", "draft-PR", head_sha)
    if str(pr.get("reviewDecision", "")) == "CHANGES_REQUESTED":
        return Evaluation("noop", "wijzigingen aangevraagd", head_sha)
    latest_reviews = pr.get("latestReviews", [])
    if not isinstance(latest_reviews, list):
        return Evaluation("noop", "reviewmetadata ontbreekt of is ongeldig", head_sha)
    if any(
        isinstance(review, Mapping) and review.get("state") == "CHANGES_REQUESTED"
        for review in latest_reviews
    ):
        return Evaluation("noop", "actief wijzigingsverzoek", head_sha)
    if not any(
        isinstance(review, Mapping)
        and review.get("state") == "APPROVED"
        and _normalize_reviewer_login(_review_author(review)) == EXPECTED_REVIEWER
        for review in latest_reviews
    ):
        return Evaluation("noop", "expliciete Gemini-goedkeuring ontbreekt", head_sha)

    check_rollup = pr.get("statusCheckRollup", [])
    if not isinstance(check_rollup, list):
        return Evaluation("noop", "checkmetadata ontbreekt of is ongeldig", head_sha)
    checks: dict[str, list[Mapping[str, Any]]] = {name: [] for name in REQUIRED_CHECKS}
    for check in check_rollup:
        if isinstance(check, Mapping) and str(check.get("name", "")) in checks:
            checks[str(check["name"])].append(check)
    missing = sorted(name for name, values in checks.items() if not values)
    if missing:
        return Evaluation("noop", f"vereiste check ontbreekt: {', '.join(missing)}", head_sha)
    for name, values in checks.items():
        if any(
            check.get("status") != "COMPLETED" or check.get("conclusion") != "SUCCESS"
            for check in values
        ):
            return Evaluation("noop", f"check niet groen: {name}", head_sha)
        expected_workflow = REQUIRED_CHECKS[name]
        if not any(check.get("workflowName") == expected_workflow for check in values):
            return Evaluation("noop", f"check komt niet uit verwachte workflow: {name}", head_sha)

    if state == "MERGED":
        return Evaluation("advance", "PR reeds gemerged; herstel baton idempotent", head_sha)
    if state != "OPEN":
        return Evaluation("noop", f"PR-state niet open: {state}", head_sha)
    if str(pr.get("mergeable", "")) != "MERGEABLE":
        return Evaluation("noop", "PR niet aantoonbaar mergebaar", head_sha)
    return Evaluation("merge", "pipeline-PR, alle gates en Gemini-goedkeuring groen", head_sha)


def _write_github_output(path: Path, result: Evaluation) -> None:
    safe_reason = " ".join(result.reason.splitlines())
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"decision={result.decision}\n")
        handle.write(f"reason={safe_reason}\n")
        handle.write(f"head_sha={result.head_sha}\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pr_json", type=Path)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args(argv)

    try:
        payload = json.loads(args.pr_json.read_text(encoding="utf-8"))
        if not isinstance(payload, Mapping):
            raise ValueError("PR-payload is geen object")
        result = evaluate_pr(payload, repository=args.repository)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        result = Evaluation("noop", f"PR-payload ongeldig: {exc}")

    if args.github_output:
        _write_github_output(args.github_output, result)
    print(json.dumps(result.__dict__, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
