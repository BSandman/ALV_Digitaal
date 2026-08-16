# ADR-0023 — Auto-advance van de PR-gate (DEV→TEST→VALIDATION) zodat de keten onbemand kan doorlopen

**Status:** geaccepteerd
**Datum:** 13 augustus 2026
**Beslisser:** Bas (go voor onbemand); vastgelegd door Claude (Architect & Validator)
**Context-links:** [[ADR-0007]] (Gemini serverless op de PR), [[ADR-0013]] (productie-deploy blijft achter GitHub-Environment-approval), [[ADR-0017]] (autorun-vangrails, attended-first, deploy blijft mens), [[ADR-0019]] (rol-runners).

## Context

De lokale autorun automatiseert de **rol-beurten** (Codex/Claude/Mistral). Maar de overgang **`READY_FOR_TEST → READY_FOR_VALIDATION`** loopt via een GitHub-PR + Gemini-review-Action + een **handmatige merge en baton-doorzet**. Niets automatiseert die stap. Daardoor loopt **elke** onbemande cyclus vast bij de Gemini-gate: zonder mens komt de keten niet voorbij de PR. Dit is de enkele grootste blokkade voor "de keten draait zichzelf".

## Besluit

Een **GitHub Action** (`pipeline-autoadvance`) sluit het gat, want de PR leeft op GitHub (past bij "Gemini/PR-gate is serverless"). Zij doet, en alleen zij, de merge + baton-doorzet.

### Voorwaarden (ALLE waar, anders: niets doen)

1. **Kill-switch aan:** repo-Actions-variabele `PIPELINE_AUTOMERGE == 'on'`. **Default = off** (attended-first, ADR-0017). Alleen Bas zet 'm aan.
2. **Pipeline-PR:** head-branch matcht `agent/*` (of label `pipeline`); base = `main`. Nooit een release-/productiebranch.
3. **Groen vinkje ÉN approved:** álle vereiste status-checks (CI-gates uit `ci.yml` én de Gemini-workflow) = success, **én** er staat een **expliciete `APPROVED`-review** van de Gemini-reviewer op de PR; geen enkele `CHANGES_REQUESTED`; mergebaar (geen conflict). De groene check alleen is niet genoeg — de formele approve moet er zijn (besluit Bas 13-08-2026).

### Actie (idempotent)

1. Squash-merge de PR.
2. Op `main`: zet `handoff.md` van `READY_FOR_TEST` → `READY_FOR_VALIDATION` (owner `claude`), geldig volgens `lint_handoff.py`; commit + push. Sla over als de baton al voorbij `READY_FOR_TEST` staat.

### Nooit

- **Geen deploy, geen productie.** CD naar productie blijft achter de Environment-approval (ADR-0013). Deze Action raakt uitsluitend merge + baton-doorzet.
- **Geen niet-pipeline-PR's** en geen PR's met changes-requested.

### Bij twijfel / falen

**Fail-safe: niets doen** — de baton blijft op `READY_FOR_TEST` voor een mens. Geen half-merge, geen forceer. Optioneel een PR-comment met de reden.

## Waar dit in de onbemande keten past

```
Codex-watcher  → bouwt, opent PR, zet READY_FOR_TEST
   ↓ (GitHub) CI-gates + Gemini-review groen
[pipeline-autoadvance Action]  → merge + READY_FOR_VALIDATION      ← NIEUW, dit gat
   ↓
Claude-watcher → valideert → READY_FOR_INTEGRATION
   ↓
Mistral-watcher → integreert → SPRINT_DONE (notifier → Bas)
```

Voor een volledig onbemande run zijn dus nodig: (a) deze Action, én (b) de drie lokale rol-watchers gelijktijdig draaiend. Deze ADR dekt (a).

## Overwogen alternatieven

- **Lokale watcher pollt `gh` en merget zelf.** Afgewezen: vereist een lokaal proces met GitHub-auth dat 24/7 draait; meer bewegende delen lokaal. De merge hoort op GitHub.
- **Auto-merge zonder Gemini-groen-gate.** Afgewezen: onveilig; de review is juist de kwaliteitspoort.
- **Direct onbemand aanzetten.** Afgewezen: `PIPELINE_AUTOMERGE` staat default uit; eerst attended bewijzen.

## Gevolgen

- **Codex:** bouwt `.github/workflows/pipeline-autoadvance.yml` + een klein, testbaar doorzet-script (baton-transitie via `lint_handoff`); guards + kill-switch + idempotentie + fail-safe; tests op het script (groen→advance, niet-groen→no-op, switch off→no-op, al-voorbij→no-op).
- **Claude:** valideert de Action + het script tegen dit ADR en ADR-0017 vóór onbemand.
- **Bas:** zet `PIPELINE_AUTOMERGE='on'` pas ná een attended bewezen cyclus; deploy/productie blijven zijn poort.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
