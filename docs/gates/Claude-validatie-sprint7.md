# Claude-validatie — Sprint 7 (PR-gate auto-advance)

**Uitkomst:** GROEN (architect-review; formele validatie zodra de baton bij Claude is). Getoetst tegen ADR-0023 en ADR-0017.
**Datum:** 13 augustus 2026 — Claude (Validator).

## Wat is getoetst

**`scripts/advance_after_merge.py`** — pure bestand-transitie, geen git (git doet de workflow):
- `--gate-green` vereist; anders no-op. Ongeldige/oneigenlijke handoff → no-op (vangt alle fouten).
- Advanceert alleen bij `READY_FOR_TEST`+`owner gemini` → `READY_FOR_VALIDATION`+`owner claude` (`next: mistral`); valideert frontmatter vóór én na render; atomische schrijf met fsync + `os.replace`. Idempotent.

**`scripts/check_pipeline_pr.py`** — fail-closed evaluator; leidt veiligheid nooit af uit ontbrekende data:
- **Fork-weigering** (head-repo moet exact deze repo zijn), geldige 40/64-hex head-SHA, `base == main`, pipelinebranch (`agent/*`) of label `pipeline`, niet-draft.
- `CHANGES_REQUESTED` (reviewDecision én latestReviews) → no-op.
- Vereiste checks moeten aanwezig, `COMPLETED`/`SUCCESS`, én uit de **verwachte workflow** komen (geen check-naam-spoofing).
- `MERGED` → `advance` (idempotent herstel); niet-open of niet-`MERGEABLE` → no-op; anders `merge`.

**`.github/workflows/pipeline-autoadvance.yml`**:
- Job draait alleen bij kill-switch `vars.PIPELINE_AUTOMERGE == 'on'` (**default uit**).
- **Checkout van `main`** (vertrouwde code — een PR kan de auto-advance-logica niet wijzigen).
- **TOCTOU-herbevestiging** vlak vóór merge; merge met **`--match-head-commit`** (exact de gecontroleerde SHA). `concurrency` voorkomt dubbele merge.
- Alleen bij een echte batonwijziging committen/pushen; raakt **nooit** deploy of productie.

Tests aanwezig: `tests/test_advance_after_merge.py`, `tests/test_check_pipeline_pr.py`.

## Bevindingen (niet-blokkerend)

1. "Groene review" = Gemini-workflow `SUCCESS` + geen `CHANGES_REQUESTED` — **geen** expliciete `APPROVED` vereist. Bevestig of dat de bedoelde poort is (anders: aanscherpen naar APPROVED).
2. Tijdens de attended proef: controleer dat de namen in `REQUIRED_CHECKS` exact matchen met de echte check-namen. Mismatch = veilige no-op (merget niet), dus nooit onveilig — maar je wilt een échte merge zien.

## Conclusie

Voldoet aan ADR-0023 en ADR-0017; de implementatie overtreft de spec in strengheid (fork-weigering, TOCTOU-recheck, match-head-commit, workflow-binding). Geen blokkerende bevindingen.

**Bootstrap-nuance:** deze PR (die de auto-advance tóevoegt) advanced zichzelf niet — `PIPELINE_AUTOMERGE` staat uit, dus hij wordt **handmatig** gemerged, net als Sprint 6. Daarna: attended proef met de switch aan op een volgende pipeline-PR, en dan pas onbemand.
