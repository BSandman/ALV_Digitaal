# Codex-taak — Sprint 7: PR-gate auto-advance (ADR-0023)

Doel: de handmatige stap "merge PR + zet baton op `READY_FOR_VALIDATION`" automatiseren, zodat de onbemande keten voorbij de Gemini/PR-gate komt. Ontwerp: **ADR-0023**.

## A — Doorzet-script (testbaar, los van GitHub)

`scripts/advance_after_merge.py` (dependency-vrij, hergebruikt `lint_handoff.py`):

- Input: het huidige `handoff.md` + een expliciete "gate-groen"-vlag (uit de Action).
- Regels:
  - Alleen als `state == READY_FOR_TEST` én `owner == gemini`: zet `state = READY_FOR_VALIDATION`, `owner = claude`, geldige frontmatter (via `validate_values`), korte `note`.
  - **Idempotent:** staat de baton al voorbij `READY_FOR_TEST`, doe niets (exit 0, "reeds voorbij").
  - Niet-groen of verkeerde state → **niets doen** (exit 0, no-op) — fail-safe.
- Geen git in dit script zelf; het schrijft alleen `handoff.md`. De Action doet commit/push.

## B — GitHub Action

`.github/workflows/pipeline-autoadvance.yml`:

- **Triggers:** `pull_request_review` (submitted), `check_suite` (completed), en/of `workflow_run` (de CI- en Gemini-workflows, completed).
- **Guards (job draait alleen als ALLE waar):**
  1. `vars.PIPELINE_AUTOMERGE == 'on'` (kill-switch, **default niet gezet = off**).
  2. PR-head matcht `agent/*` (of label `pipeline`); base = `main`.
  3. Álle vereiste checks success **én** Gemini-review groen/approved; geen `changes-requested`; `mergeable == true`.
- **Stappen:** squash-merge via `gh pr merge --squash`; daarna op `main` `advance_after_merge.py` draaien, committen + pushen. Idempotent; concurrency-guard zodat twee triggers niet dubbel mergen.
- **Nooit:** deploy, productie, of niet-pipeline-PR's. Raakt uitsluitend merge + baton.
- **Fail-safe:** bij twijfel/fout niets mergen; optioneel een PR-comment met de reden.

## C — Config, docs

- Documenteer de repo-variabele `PIPELINE_AUTOMERGE` (on/off) in `AGENTS.md` (§autorun) en README-structuur; default off = attended-first.
- Werk de runbook bij: onbemand = deze Action `on` **plus** de drie lokale rol-watchers draaiend; deploy blijft mens.

## Acceptatiecriteria / tests (op het script)

1. `READY_FOR_TEST`+`gemini`+groen → `READY_FOR_VALIDATION`+`claude`, geldige frontmatter.
2. Niet-groen → no-op; baton onveranderd.
3. Kill-switch off (in de Action) → job draait niet (documenteer/gedragstest waar mogelijk).
4. Al voorbij `READY_FOR_TEST` → no-op (idempotent).
5. Ongeldige/onbekende state → no-op, geen exceptie die de repo muteert.
6. `npm run check` + Python-tests + gates + Gemini groen.

## Overdracht

PR openen (`agent/*`-branch) → gates + Gemini → `READY_FOR_VALIDATION` voor Claude. Baton nu op `READY_FOR_TEST` (Sprint 6, gemini); Bas/Codex zet 'm ná de Sprint 6-merge naar `READY_FOR_DEV` om deze Sprint 7 te starten.
