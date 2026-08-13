# sprint.md — Sprint 7: PR-gate auto-advance

**Doel:** de groene PR-gate automatisch laten mergen en de baton veilig doorzetten naar Claude, zodat de lokale rolwatchers niet bij `READY_FOR_TEST` blijven steken. Besluit: **ADR-0023**. Spec: **`docs/gates/Codex-taak-pr-auto-advance.md`**.

## Cadans — per sub-taak

| Blok | Rol | Watcher | Inhoud |
|---|---|---|---|
| 1 | **Codex** (dev) | `--role codex` | Doorzet-script, PR-evaluator, GitHub Action, runbook en contracttests; PR |
| 2 | *auto* | — | CI-gates + Gemini-review |
| 3 | **Claude** (validatie) | `--role claude` | Toets auto-advance tegen ADR-0023/0017 |
| 4 | **Bas + rollen** | attended | Switch tijdelijk aan voor één bewezen pipeline-PR; daarna bewust uit/aan beslissen |

## Scope

- **Batontransitie:** dependency-vrij, valideert frontmatter, alleen groen + `READY_FOR_TEST/gemini` → `READY_FOR_VALIDATION/claude`; alle andere invoer is no-op.
- **PR-evaluator:** alleen `main`, eigen repo, pipelinebranch of -label, geen draft/changes-requested, exacte vereiste groene checks en mergebare PR.
- **GitHub Action:** kill-switch `PIPELINE_AUTOMERGE` default uit, workflow-run + handmatige hersteltrigger, concurrency-guard, squash-merge en daarna één batoncommit op `main`.
- **Veiligheidsgrens:** geen force-push, geen deploy/productie, bij onbekende of ambigue staat niets doen.

## Definition of done

- Script- en workflowcontracttests dekken groen, rood, switch-uit, reeds-voorbij, onbekend, verkeerde branch/repo, reviewblokkade en ontbrekende check.
- `npm run check`, Python-tests, handoff-, architectuur-, release- en PII-gates en Gemini-review groen.
- Claude valideert tegen ADR-0023; pas daarna activeert Bas de switch voor één begeleide echte cyclus.

## Buiten scope

Automatische deploy/productie · de switch tijdens bouw of review aanzetten · nieuwe productfunctionaliteit · lokale Gemini-runner.
