# sprint.md — Sprint 8: Gemini groen én formeel approved

**Doel:** de auto-advance pas laten mergen als de Gemini-workflow groen is én Gemini als verwachte reviewer een expliciete `APPROVED`-review heeft geplaatst. Besluit: aangescherpte **ADR-0023**. Spec: **`docs/gates/Codex-taak-gemini-approved-gate.md`**.

## Cadans — per sub-taak

| Blok | Rol | Watcher | Inhoud |
|---|---|---|---|
| 1 | **Codex** (dev) | `--role codex` | Verdict-parser, formele Gemini-review, strengere PR-evaluator en contracttests; PR |
| 2 | *auto* | — | CI-gates + formele Gemini-review |
| 3 | **Claude** (validatie) | `--role claude` | Toets groen+approved tegen ADR-0023/0017 |
| 4 | **Bas + rollen** | attended | Bot-approvalinstelling en switch gecontroleerd activeren voor één bewezen pipeline-PR |

## Scope

- **Gemini-verdict:** exact één `VERDICT: APPROVE` of `VERDICT: REQUEST_CHANGES` als laatste inhoudsregel; ontbrekend of ambigu wordt `REQUEST_CHANGES`.
- **Formele review:** `pulls.createReview`, gebonden aan de PR-head; verwachte auteur `github-actions[bot]`.
- **PR-evaluator:** naast de bestaande interne branch-, check-, workflow-, review- en mergevoorwaarden is expliciete verwachte `APPROVED` verplicht.
- **Veiligheidsgrens:** switch default uit, geen force-push, geen deploy/productie; onbekende of ambigue metadata is no-op.

## Definition of done

- Tests dekken formele approve, ontbrekende approve, verkeerde reviewer, actief wijzigingsverzoek en ontbrekende/ambigue verdict-trailers.
- `npm run check`, Python-tests, handoff-, architectuur-, release- en PII-gates en formele Gemini-review groen.
- Claude valideert tegen ADR-0023; pas daarna activeert Bas de bot-approvalinstelling en switch voor één begeleide echte cyclus.

## Buiten scope

Automatische deploy/productie · `REQUEST_CHANGES` automatisch terugrouteren naar Codex · de switch tijdens bouw of review aanzetten · nieuwe productfunctionaliteit · lokale Gemini-runner.
