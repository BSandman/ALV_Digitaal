#!/usr/bin/env python3
"""Fail-closed P0a pipeline identity, setup and recovery guardrails.

This module deliberately separates observation and planning from mutation.  In
P0a an exact-SHA merge is only emitted as a dry-run plan; ``on`` is refused.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence


SHA_RE = re.compile(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})\Z")
VERSION_RE = re.compile(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\Z")
INFRA_VERSION_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")


class PipelineGuardError(RuntimeError):
    """A fail-closed pipeline inconsistency safe to report to Bas."""


@dataclass(frozen=True)
class PrResolution:
    decision: str
    reason: str
    number: int
    head_sha: str


@dataclass(frozen=True)
class SprintMetadata:
    sprint: int
    branch: str
    release_namespace: str
    version: str
    release_tag: str
    release_sha: str | None
    require_branches_up_to_date: bool
    native_automerge: str


@dataclass(frozen=True)
class EmergencyPlan:
    dry_run: bool
    commands: tuple[str, ...]
    reason: str


@dataclass(frozen=True)
class MergePlan:
    enabled: bool
    dry_run: bool
    command: tuple[str, ...]
    reason: str


def _repository_name(payload: Mapping[str, Any]) -> str:
    repository = payload.get("headRepository")
    if not isinstance(repository, Mapping):
        return ""
    if repository.get("nameWithOwner"):
        return str(repository["nameWithOwner"])
    return ""


def _labels(payload: Mapping[str, Any]) -> set[str]:
    labels = payload.get("labels", [])
    if not isinstance(labels, list):
        raise PipelineGuardError("PR-labelmetadata ontbreekt of is ongeldig")
    return {
        str(label.get("name", "")).casefold()
        for label in labels
        if isinstance(label, Mapping)
    }


def _required_pr_fields(payload: Mapping[str, Any]) -> tuple[int, str, str, str, str]:
    try:
        number = int(payload["number"])
        state = str(payload["state"])
        base = str(payload["baseRefName"])
        branch = str(payload["headRefName"])
        sha = str(payload["headRefOid"])
    except (KeyError, TypeError, ValueError) as exc:
        raise PipelineGuardError("verplichte PR-identiteit ontbreekt") from exc
    if number < 1 or state not in {"OPEN", "CLOSED", "MERGED"}:
        raise PipelineGuardError("ongeldig PR-nummer of PR-state")
    if not SHA_RE.fullmatch(sha):
        raise PipelineGuardError("ongeldige PR-head-SHA")
    return number, state, base, branch, sha.lower()


def resolve_pr_identity(
    primary: Mapping[str, Any],
    branch_matches: Sequence[Mapping[str, Any]],
    *,
    expected_number: int,
    expected_repository: str,
    expected_branch: str,
    expected_sha: str,
    follow_up_done: bool,
) -> PrResolution:
    """Resolve a trusted PR number first and use branch search only as a cross-check."""
    number, state, base, branch, sha = _required_pr_fields(primary)
    if number != expected_number:
        raise PipelineGuardError("vertrouwd PR-nummer wijkt af van direct gelezen PR")
    if _repository_name(primary).casefold() != expected_repository.casefold():
        raise PipelineGuardError("PR-repository wijkt af; fork of verkeerde repo")
    if base != "main" or branch != expected_branch:
        raise PipelineGuardError("PR-base of branch wijkt af van de verwachte identiteit")
    if not SHA_RE.fullmatch(expected_sha) or sha != expected_sha.casefold():
        raise PipelineGuardError("PR-head-SHA wijkt af van de verwachte exacte SHA")

    matches = list(branch_matches)
    if len(matches) > 1:
        raise PipelineGuardError("meerdere PR's gevonden voor dezelfde branch; identiteit ambigu")
    if state == "OPEN":
        if not matches:
            raise PipelineGuardError("verwachte open PR ontbreekt in secundaire branchzoekopdracht")
        match_number, match_state, match_base, match_branch, match_sha = _required_pr_fields(matches[0])
        if (
            match_number != number
            or match_state != "OPEN"
            or match_base != base
            or match_branch != branch
            or match_sha != sha
        ):
            raise PipelineGuardError("secundaire branchzoekopdracht wijkt af van primaire PR-identiteit")
        return PrResolution("open", "exact PR-nummer, repo, branch en head-SHA geverifieerd", number, sha)

    if matches:
        raise PipelineGuardError("gesloten primaire PR heeft nog een branchmatch; toestand inconsistent")
    if state not in {"MERGED", "CLOSED"} or not follow_up_done:
        raise PipelineGuardError("nul branchmatches is alleen no-op na bewezen sluiting en vervolgactie")
    return PrResolution(
        "noop", f"PR #{number} is bewezen {state}; vervolgactie was al idempotent voltooid", number, sha
    )


def _is_pipeline_pr(payload: Mapping[str, Any]) -> bool:
    try:
        _, state, base, branch, _ = _required_pr_fields(payload)
        labels = _labels(payload)
    except PipelineGuardError:
        raise
    return state == "OPEN" and base == "main" and (
        branch.startswith("agent/") or "pipeline" in labels
    )


def enforce_single_pipeline_pr(
    pull_requests: Sequence[Mapping[str, Any]],
) -> Mapping[str, Any] | None:
    candidates = [payload for payload in pull_requests if _is_pipeline_pr(payload)]
    if len(candidates) > 1:
        numbers = ", ".join(f"#{int(payload['number'])}" for payload in candidates)
        raise PipelineGuardError(
            f"meer dan één open pipeline-PR naar main ({numbers}); zet baton BLOCKED"
        )
    return candidates[0] if candidates else None


def load_sprint_metadata(path: Path) -> SprintMetadata:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise PipelineGuardError(f"sprintmetadata onleesbaar: {path}") from exc
    if not isinstance(payload, Mapping):
        raise PipelineGuardError("sprintmetadata moet een JSON-object zijn")
    expected_keys = {
        "sprint", "branch", "release_namespace", "version", "release_tag", "release_sha",
        "require_branches_up_to_date", "native_automerge",
    }
    if set(payload) != expected_keys:
        raise PipelineGuardError("sprintmetadata heeft ontbrekende of onverwachte velden")
    try:
        sprint = int(payload["sprint"])
        branch = str(payload["branch"])
        release_namespace = str(payload["release_namespace"])
        version = str(payload["version"])
        release_tag = str(payload["release_tag"])
        release_sha_raw = payload["release_sha"]
        require_up_to_date = payload["require_branches_up_to_date"]
        native_automerge = str(payload["native_automerge"])
    except (TypeError, ValueError) as exc:
        raise PipelineGuardError("sprintmetadata bevat ongeldige veldtypen") from exc
    release_sha = None if release_sha_raw is None else str(release_sha_raw).lower()
    if sprint < 1 or not branch.startswith("agent/"):
        raise PipelineGuardError("sprintnummer of sprintbranch is ongeldig")
    if release_namespace == "app":
        canonical_release = VERSION_RE.fullmatch(version) and release_tag == f"v{version}"
    elif release_namespace == "infra":
        canonical_release = (
            INFRA_VERSION_RE.fullmatch(version) is not None
            and release_tag == f"infra-{version}"
        )
    else:
        canonical_release = False
    if not canonical_release:
        raise PipelineGuardError("release-namespace, versie en gereserveerde tag zijn niet canoniek")
    if release_sha is not None and not SHA_RE.fullmatch(release_sha):
        raise PipelineGuardError("geregistreerde release-SHA is ongeldig")
    if require_up_to_date is not False:
        raise PipelineGuardError("require branches up-to-date moet in de hybride fase uit staan")
    if native_automerge != "off":
        raise PipelineGuardError("native auto-merge moet in P0a uit staan")
    return SprintMetadata(
        sprint, branch, release_namespace, version, release_tag, release_sha,
        require_up_to_date, native_automerge,
    )


def verify_reserved_tag(metadata: SprintMetadata, existing_sha: str | None) -> str:
    """Validate an immutable release-tag reservation without ever moving a tag."""
    if existing_sha is None:
        return "reserved"
    normalized = existing_sha.casefold()
    if not SHA_RE.fullmatch(normalized):
        raise PipelineGuardError("bestaande release-tag heeft een ongeldige SHA; incident-route")
    if metadata.release_sha is None or normalized != metadata.release_sha.casefold():
        raise PipelineGuardError("bestaande release-tag wijkt af van de reservatie; harde incident-route")
    return "exact"


def emergency_rebase_plan(
    *, paused: bool, branch: str, old_sha: str, new_main_sha: str
) -> EmergencyPlan:
    if not paused:
        raise PipelineGuardError("repo-brede pauze moet actief zijn vóór het noodpad")
    if not branch.startswith("agent/") or not SHA_RE.fullmatch(old_sha) or not SHA_RE.fullmatch(new_main_sha):
        raise PipelineGuardError("noodpad-identiteit is ongeldig")
    commands = (
        "git fetch origin main",
        f"git switch {branch}",
        f"git rebase --onto {new_main_sha.lower()} {old_sha.lower()} {branch}",
        "git push --force-with-lease=<expliciete-oude-head>",
    )
    return EmergencyPlan(
        True,
        commands,
        "dry-run: gecontroleerde rebase maakt een nieuwe head-SHA; alle checks opnieuw, geen merge-commit",
    )


def exact_sha_merge_plan(setting: str, pr_number: int, head_sha: str) -> MergePlan:
    normalized = setting.strip().casefold()
    if pr_number < 1 or not SHA_RE.fullmatch(head_sha):
        raise PipelineGuardError("mergeplan mist een geldig PR-nummer of exacte head-SHA")
    command = (
        "gh", "pr", "merge", str(pr_number), "--auto", "--squash",
        "--match-head-commit", head_sha.lower(),
    )
    if normalized in {"", "off"}:
        return MergePlan(False, True, command, "PIPELINE_AUTOMERGE is off; geen mutatie")
    if normalized == "dry-run":
        return MergePlan(False, True, command, "exact-SHA-mergeplan uitsluitend getoond")
    raise PipelineGuardError("P0a weigert actieve native auto-merge; alleen off/dry-run toegestaan")


def _run_json(command: Sequence[str]) -> Any:
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        detail = " ".join((result.stderr or result.stdout or "onbekende fout").splitlines())[:240]
        raise PipelineGuardError(f"observatiecommando faalde: {detail}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise PipelineGuardError("observatiecommando gaf geen geldige JSON") from exc


def _existing_remote_tag(remote: str, tag: str) -> str | None:
    result = subprocess.run(
        ["git", "ls-remote", "--tags", remote, f"refs/tags/{tag}", f"refs/tags/{tag}^{{}}"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode:
        raise PipelineGuardError("release-tag kon niet fail-closed worden geobserveerd")
    shas = [line.split()[0].lower() for line in result.stdout.splitlines() if line.split()]
    if not shas:
        return None
    return shas[-1]


def _repository_variable(repository: str, name: str) -> str | None:
    result = subprocess.run(
        ["gh", "variable", "get", name, "--repo", repository],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode:
        detail = " ".join((result.stderr or result.stdout or "onleesbaar").splitlines())[:160]
        raise PipelineGuardError(f"repositoryvariabele {name} kon niet fail-closed worden gelezen: {detail}")
    value = result.stdout.strip()
    if not value:
        raise PipelineGuardError(f"repositoryvariabele {name} is leeg of ontbreekt")
    return value


def validate_live_repository_safety(
    *,
    repository_variable: str,
    workflow_state: str,
    require_branches_up_to_date: bool,
) -> dict[str, object]:
    """Validate live GitHub state; sprintmetadata is only a non-authoritative expectation."""
    if repository_variable != "off":
        raise PipelineGuardError("PIPELINE_AUTOMERGE moet live leesbaar en exact 'off' zijn")
    if workflow_state != "disabled_manually":
        raise PipelineGuardError("pipeline-autoadvance workflow moet live disabled_manually zijn")
    if require_branches_up_to_date is not False:
        raise PipelineGuardError("branch-protection strict/up-to-date moet live uit staan")
    return {
        "decision": "ok",
        "pipeline_automerge": repository_variable,
        "autoadvance_workflow": workflow_state,
        "require_branches_up_to_date": require_branches_up_to_date,
    }


def _strict_boolean(value: str, *, label: str) -> bool:
    if value == "true":
        return True
    if value == "false":
        return False
    raise PipelineGuardError(f"{label} moet exact true of false zijn")


def _jsonable(value: object) -> object:
    if hasattr(value, "__dict__"):
        return value.__dict__
    return value


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    setup = commands.add_parser("setup")
    setup.add_argument("--metadata", type=Path, required=True)
    setup.add_argument("--repository", required=True)
    setup.add_argument("--remote", default="origin")
    live_source = setup.add_mutually_exclusive_group()
    live_source.add_argument(
        "--runtime-automerge",
        help="live waarde uit GitHub Actions vars; zonder deze optie leest gh de repovariabele",
    )
    live_source.add_argument(
        "--defer-live-safety-to-ci",
        action="store_true",
        help="lokale watcher: CI moet de live repo-status daarna fail-closed verifiëren",
    )
    resolve = commands.add_parser("resolve")
    resolve.add_argument("--pr-number", required=True, type=int)
    resolve.add_argument("--repository", required=True)
    resolve.add_argument("--branch", required=True)
    resolve.add_argument("--head-sha", required=True)
    resolve.add_argument("--follow-up-done", action="store_true")
    merge = commands.add_parser("merge-plan")
    merge.add_argument("--setting", default="off")
    merge.add_argument("--pr-number", required=True, type=int)
    merge.add_argument("--head-sha", required=True)
    emergency = commands.add_parser("emergency-rebase-plan")
    emergency.add_argument("--pause-file", type=Path, required=True)
    emergency.add_argument("--branch", required=True)
    emergency.add_argument("--old-sha", required=True)
    emergency.add_argument("--new-main-sha", required=True)
    live = commands.add_parser("live-safety")
    live.add_argument("--repository-variable", required=True)
    live.add_argument("--workflow-state", required=True)
    live.add_argument("--require-branches-up-to-date", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "setup":
            metadata = load_sprint_metadata(args.metadata)
            payload = _run_json([
                "gh", "pr", "list", "--repo", args.repository, "--state", "open", "--base", "main",
                "--limit", "100", "--json",
                "number,state,baseRefName,headRefName,headRefOid,headRepository,labels",
            ])
            if not isinstance(payload, list):
                raise PipelineGuardError("open-PR-observatie is geen lijst")
            active = enforce_single_pipeline_pr(payload)
            if active is not None and str(active.get("headRefName")) != metadata.branch:
                raise PipelineGuardError("enige open pipeline-PR hoort niet bij de gereserveerde sprintbranch")
            tag_status = verify_reserved_tag(
                metadata, _existing_remote_tag(args.remote, metadata.release_tag)
            )
            if args.defer_live_safety_to_ci:
                runtime_automerge = None
                live_status = "deferred-to-ci"
            else:
                runtime_automerge = (
                    args.runtime_automerge
                    if args.runtime_automerge is not None
                    else _repository_variable(args.repository, "PIPELINE_AUTOMERGE")
                )
                if runtime_automerge != "off":
                    raise PipelineGuardError(
                        "PIPELINE_AUTOMERGE moet live leesbaar en exact 'off' zijn"
                    )
                live_status = "verified-off"
            result: object = {
                "decision": "ok", "active_pr": active.get("number") if active else None,
                "release_tag": metadata.release_tag, "tag_status": tag_status,
                "metadata_native_automerge_expectation": metadata.native_automerge,
                "live_safety": live_status,
            }
        elif args.command == "resolve":
            fields = "number,state,baseRefName,headRefName,headRefOid,headRepository,labels"
            primary = _run_json(["gh", "pr", "view", str(args.pr_number), "--repo", args.repository, "--json", fields])
            matches = _run_json([
                "gh", "pr", "list", "--repo", args.repository, "--state", "all", "--base", "main",
                "--head", args.branch, "--limit", "100", "--json", fields,
            ])
            if not isinstance(primary, Mapping) or not isinstance(matches, list):
                raise PipelineGuardError("PR-observatie heeft een ongeldig type")
            result = resolve_pr_identity(
                primary, matches, expected_number=args.pr_number,
                expected_repository=args.repository, expected_branch=args.branch,
                expected_sha=args.head_sha, follow_up_done=args.follow_up_done,
            )
        elif args.command == "merge-plan":
            result = exact_sha_merge_plan(args.setting, args.pr_number, args.head_sha)
        elif args.command == "emergency-rebase-plan":
            result = emergency_rebase_plan(
                paused=args.pause_file.is_file(), branch=args.branch,
                old_sha=args.old_sha, new_main_sha=args.new_main_sha,
            )
        else:
            result = validate_live_repository_safety(
                repository_variable=args.repository_variable,
                workflow_state=args.workflow_state,
                require_branches_up_to_date=_strict_boolean(
                    args.require_branches_up_to_date,
                    label="require-branches-up-to-date",
                ),
            )
    except PipelineGuardError as exc:
        print(f"PIPELINE_GUARD_BLOCKED: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(_jsonable(result), ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
