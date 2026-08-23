# sprint.md — Sprint 13: CI/CD-hardening P0a (liveness/correctheid)

**Doel:** de pijplijn **correct en observeerbaar** maken — de eerste, plan-agnostische fase van de CI/CD-herinrichting (**ADR-0026**). Een betrouwbare `main`-observatie, echte compare-and-swap in de GitSteward, exacte PR/SHA-identiteit, de 1-sprint-1-PR-invariant hard afgedwongen, en een noodpad voor een bewegende `main`. **Native auto-merge gaat NIET aan** (merge-enabler off; attended exact-SHA-merge) — dat is P0b. Detail: `Platform/_design-prestage/cicd/CICD-herontwerp-DEFINITIEF.md` (P0a). Spec: `docs/gates/Codex-taak-cicd-p0a.md`.

> **Zelf-modificerend + attended.** Deze sprint wijzigt `git_steward.py`/`watch_handoff.py`/de setup-lint die de beurten zelf draaien. Draai `--max-turns 1` met Bas erbij; **watchers op `main`** (niet op de feature-branch — de Sprint-10-les); branch = **`agent/sprint-13-cicd-p0a`** (niet `feat/`); merge attended en exact op SHA. Een begeleide beurt moet schoon + in-sync eindigen voor je op de nieuwe steward leunt.

## Cadans — per blok
| Blok | Rol | Watcher | Inhoud |
|---|---|---|---|
| 1 | **Codex** (dev) | `--role codex` (op main) | GitSteward-CAS + testset, main-observatie, PR/SHA-verificatie, 1-PR-invariant, noodpad; PR op `agent/sprint-13-cicd-p0a` |
| 2 | *auto* | — | CI-gates + Gemini-review op de PR |
| 3 | **Claude** (validatie) | Cowork | Toets tegen ADR-0026 + de P0a-acceptatiecriteria |
| 4 | **Mistral** (integratie) | `--role mistral` (op main) | Gates; **attended exact-SHA-merge**; geen deploy |

## Scope (in) — acceptatiecriteria in het taakdoc
Main-observatie (aparte schone worktree), GitSteward echte CAS + idempotente transitie + concurrentie-/idempotentie-testset, exacte PR-nummer/SHA-verificatie (0/1/>1-gedrag), 1-sprint-1-PR setup-lint-invariant, noodpad voor een bewegende `main`. Merge-enabler op `off`.

## Scope (uit) — P0b of later
Privileged/unprivileged workflow-split, echte Gemini-verdict-check, PII context-aware gate, native auto-merge activeren, Environment/deploy-poort, dedup-notifier, lease, labels-migratie, validatie-voor-merge.

## Definition of done / go-no-go -> P0b
CAS-testset groen (concurrerende schrijver, stale source, doelstaat-al-bereikt, ongeldige sprong, gelijktijdige `progress.md`); PR/SHA-resolve bewezen (nul -> bewezen MERGED/CLOSED-no-op, >1 -> fail-luid); 1-PR-invariant blokkeert een tweede open `agent/*`-PR aantoonbaar; noodpad-rebase in droogloop bewezen; **geen** actieve native auto-merge. `npm run check` + Python-tests + gates + Gemini groen. Geen deploy; geen productcode buiten de PR.
