# sprint.md — Sprint 11: Git-hardening (GitSteward)

**Doel:** het leeuwendeel van de autorun-uitval (git) structureel wegnemen. Een apart deterministisch **GitSteward**-proces wordt de enige git-schrijver naar `main` en de enige houder van push-credentials; LLM-runners worden git-light (offline-sandboxbaar). Verplichte block-finalize + retry maken de tree altijd schoon en GitHub altijd de waarheid. Besluit: **ADR-0025**. Spec: **`docs/gates/Codex-taak-gitsteward.md`**.

> Sprint 10 (eigenaar-frontend) is bewust **gepauzeerd** en hervat direct na deze hardening (ADR-0024 + `docs/gates/Codex-taak-frontend-eigenaar.md` blijven geldig). Reden: eerst de straat robuust, dan pas de 10-runs-test.

## Cadans — per blok

| Blok | Rol | Watcher | Inhoud |
|---|---|---|---|
| 1 | **Codex** (dev) | `--role codex` | GitSteward-proces + `watch_handoff.py`-refactor + retry/block-finalize; tests; PR |
| 2 | *auto* | — | CI-gates + Gemini-review op de PR |
| 3 | **Claude** (validatie) | `--role claude` | Toets tegen ADR-0025 (block-finalize, credential-isolatie, geen productcode naar main) |
| 4 | **Mistral** (integratie) | `--role mistral` | Gates; geen deploy |

## Scope

- **In:** deterministische GitSteward (`sync` + `block_finalize`, retry/backoff, stale-`index.lock`-opruiming, `GH_TOKEN` uit `secure/`); watcher delegeert git aan de steward; verplichte block-finalize (BLOCKED-baton+progress altijd gecommit+gepusht); runners git-light/offline-baar.
- **Uit:** feature-branch-commits + PR-creatie volledig naar de steward trekken · de PR-gate/auto-advance-mergeroute wijzigen · deploy · productfunctionaliteit · Gemini lokaal.

## Definition of done

- Block-finalize bewezen: runner blokkeert vóór commit → steward commit+pusht BLOCKED-baton + progressregel; `git status --porcelain` leeg, `HEAD...@{u}` = `0 0`.
- Transient git (stale lock, non-fast-forward) hersteld via retry/rebase zónder blokkade; echt-kapot escaleert netjes naar Bas.
- Credential-isolatie: een runner zonder `GH_TOKEN`/netwerk doet zijn beurt lokaal; alleen de steward pusht. Geen half-af productcode naar `main`.
- `npm run check` + Python-tests + architectuur-, release-, handoff- en PII-gates + Gemini-review groen. **Geen deploy.**

## Buiten scope

Automatische deploy/productie · magic-link/admin-UI (Sprint 10-frontend) · nieuwe merge-route naar main · onbemand/overnight zonder aparte Bas-go.
