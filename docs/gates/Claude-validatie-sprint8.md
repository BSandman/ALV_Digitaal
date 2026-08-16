# Claude-validatie — Sprint 8 (Gemini formele review; poort eist groen ÉN approved)

**Uitkomst:** GROEN (architect-review; formeel zodra de baton bij Claude is). Getoetst tegen ADR-0023 (aangescherpt) en de Codex-taak `Codex-taak-gemini-approved-gate.md`.
**Datum:** 13 augustus 2026 — Claude (Validator).

## Wat is getoetst

**`.github/workflows/gemini-review.yml`** — Gemini geeft nu een **formele review** i.p.v. een comment:
- De prompt eist een machine-leesbare slotregel `VERDICT: APPROVE` of `VERDICT: REQUEST_CHANGES` (met toelichting vóór een REQUEST_CHANGES).
- `pulls.createReview` met `event: APPROVE`/`REQUEST_CHANGES` op de head-SHA; auteur = `github-actions[bot]`. Onbekend event → `core.setFailed` (job rood). PII-voorwacht + API-fout blijven rood → geen review.

**`scripts/parse_gemini_verdict.py`** — fail-closed: exact één `VERDICT:`-regel én op de **laatste** niet-lege regel, anders `REQUEST_CHANGES` (ontbrekend/dubbelzinnig/leesfout → `REQUEST_CHANGES`).

**`scripts/check_pipeline_pr.py`** — poort eist nu **groen ÉN approved**:
- Verplicht: een `APPROVED`-review van de verwachte reviewer (`EXPECTED_REVIEWER = github-actions[bot]`); ontbreekt die → `noop` "goedkeuring ontbreekt". Approval van een **andere** auteur telt niet.
- Behoudt: groene vereiste checks uit de juiste workflow, fork-weigering, base=main, pipelinebranch, geen `CHANGES_REQUESTED`, mergebaar. Extra type-checks (reviews/checks moeten lijsten zijn) → fail-closed.

## Tests (bevestigd aanwezig + dekkend)

`test_parse_gemini_verdict.py`, `test_check_pipeline_pr.py`: groen zónder approval → `noop`; approval van verkeerde/ontbrekende auteur → `noop`; ongeldige review-/checkmetadata → `noop`; plus de bestaande fork/base/draft/changes-requested/spoof-checks. Codex meldt 83/83 Node + 91/91 Python groen.

## Conclusie

Voldoet aan ADR-0023 (aangescherpt: groen vinkje **én** expliciete Gemini-approve). Implementatie is fail-closed op elk pad.

**Bevinding — OPGELOST (Codex, PR #17 commit `a7d9b92`):** GitHub rapporteerde de reviewer-login als `github-actions` (zónder `[bot]`), terwijl de evaluator `github-actions[bot]` verwachtte — de fail-safe deed correct **niets**. Fix: normalisatie stript uitsluitend een optionele terminale `[bot]`, waarna zowel `github-actions` als `github-actions[bot]` worden geaccepteerd; andere auteurs blijven fail-closed `noop`. Bewijs: 92/92 Python + 83/83 Node groen, alle GitHub-checks groen, formele review `APPROVED`, en de **productie-evaluator geeft op de echte payload `decision: merge`**. Geen nieuwe ADR.

**Operationeel afgerond:** de repo-instelling "Allow GitHub Actions to create and approve pull requests" staat aan; PR #17 kreeg een formele Gemini-approval en is handmatig gemerged als `21c890a`. `PIPELINE_AUTOMERGE` bleef uit. Resterend: de attended proef op een vólgende pipeline-PR met de switch tijdelijk aan.
