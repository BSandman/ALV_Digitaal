# ADR-0026 — CI/CD-herinrichting: gefaseerde migratie naar GitHub-native, 1-sprint-1-PR

**Status:** geaccepteerd (richting; gefaseerde uitwerking). Leidend detaildocument: `Platform/_design-prestage/cicd/CICD-herontwerp-DEFINITIEF.md` (bewust buiten de repo tot de PII-gate contextbewust is — P0b).
**Datum:** 22 augustus 2026
**Beslisser:** Bas; ontworpen met Claude (Architect & Validator), gereviewd door Codex, Gemini en Mistral (drie rondes).
**Context-links:** [[ADR-0023]] (PR-gate auto-advance), [[ADR-0025]] (GitSteward), [[ADR-0007]] (Codex git-steward / Gemini GitHub Action), [[ADR-0013]] (deploy = menselijke poort), [[ADR-0005]] (PII-scan).

## Context
De friction van Sprint 10 was 100% coordinatie, niet product. Wortelfout: de coordinatiestaat heeft geen enkele gezaghebbende representatie die alle actoren identiek zien — hij is uitgesmeerd over de branch-locatie van `handoff.md`, of de PR-head checks draagt, `workflow_run.pull_requests`, branchnaam-conventies, en wat een credential-loze coordinator kon gokken. Een git-getrackt, branch-scoped, muteerbaar bestand als cross-branch bus is de fout; GitHub biedt die statemachine al (PR's, required checks, branch protection, Environments).

## Besluit
1. **1 sprint = 1 PR, alleen merge-source, geserialiseerd** (afgedwongen invariant). Sprint-grens = PR-grens; geen merge-commit `main`->sprintbranch.
2. **Gefaseerde migratie naar GitHub-native**, hybride: **P0a** maakt de pijplijn correct/observeerbaar; **P0b** maakt haar veilig genoeg voor native auto-merge; **Fase 2** maakt `merge == sprint-done`. Geen merge queue (tier).
3. **Kern-invarianten:** guardrails draaien vanuit vertrouwde `main` (privileged/unprivileged split); Gemini-verdict = echte rood/groen SHA-gebonden check; een merge-eigenaar; GitSteward met echte CAS + idempotente transitie; PII context/parser-aware + fail-closed (eigenaar Mistral, uitvoerder CI); exacte-SHA-identiteit overal; read-only token voor observability, App-token voor CI-triggerende writes; een dedup-notifier.
4. **Deploy permanent menselijk** (ADR-0013); release-tag = onveranderlijke identiteit op de gerapporteerde merge-SHA; deploystatus via native Deployments/Environments.

## Overwogen alternatieven
- **Alles patchen (v1-richting).** Afgewezen: blijft tegen het substraat vechten.
- **Alles-native-in-een-keer.** Afgewezen: te grote sprong op een zelf-modificerende pijplijn; hybride de-riskt.
- **Merge queue als kern.** Afgewezen: niet beschikbaar op de huidige repo-tier.

## Gevolgen
Zelf-modificerend -> attended, gefaseerd met expliciete go/no-go per fase. Native auto-merge/branch-protection is tier-afhankelijk (private repo >= Pro); tot bevestigd blijft de merge attended + exact-SHA en de deploy-poort een afgedwongen `workflow_dispatch`-gate.
