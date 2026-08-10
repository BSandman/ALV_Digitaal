---
sprint: 1
state: READY_FOR_TEST
owner: gemini
since: 2026-08-10T13:52:02Z
next: claude
action_required_by: none
blocked: false
note: "Taak 10.2 groen op feat/sprint-1-t-run-ci-gates; Gemini reviewt via PR, Claude voegt wegens documenteigenaarschap het T-commando aan README toe."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

### 1. Doel

Taak 10.2 levert een reproduceerbare T-run, een veldgelijke synthetische seedroute, CI-gate A (ADR-0002), CI-gate B (ADR-0005) en een code-only release-artefact.

### 2. Gewijzigde bestanden

Featurebranch `feat/sprint-1-t-run-ci-gates`, commit `af14f3a`; wijzigingen in `.github/workflows/`, `app/`, `infra/`, `mistral-lokaal/scripts/pii_scan`, `scripts/` en `tests/`.

### 3. Testbewijs

Groen: 7/7 Node-tests; gate A; gate B op diff+fixtures+artefact; Compose-config; MariaDB 11.8.8 met 120 deelnemers/rechten; strict SQL-mode + UTC; app 2 GB/2 CPU en één Node-proces. k6: 1.783 requests, 0,00% fouten, status-p95 3,56 ms, vote-p95 17,15 ms, 120/120 stemburst.

### 4. Privacyclassificatie

Schoon: deterministische scan van branchdiff, fixtures en `alv-digitaal-app-v0.1.0.tgz` (11 code-/manifestpaden). Negatietest met dynamisch aangemaakt `owners.initial.js`-artefact faalt aantoonbaar. `secure/`, `out/`, `.env`, data en runtimebestanden zijn uitgesloten.

### 5. Open risico's

Mistral moet de lokale denylist met bekende echte VvE-/straatnamen beheren. README-update “Snel starten (test)” blijft voor Claude, omdat alleen Claude README/bijbel mag wijzigen. Productfunctionaliteit en echte stemverwerking blijven conform sprintscope buiten deze taak.

### 6. Rollback

Revert commit `af14f3a`; verwijder desgewenst alleen de Docker-resources met projectnaam `alv-digitaal`. De initialisatiecommit en ADR-/besturingshistorie blijven behouden.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-10 — Claude: architectuur, OTAP, ADR-0001..0006, AGENTS/bijbel/sprint + agent-instructies opgezet. → READY_FOR_DEV.
- 2026-08-10 — Codex: BLOCKED — VvE_Werk/.git leeg, geen commits mogelijk.
- 2026-08-10 — Claude: gediagnosticeerd + ADR-0007 (repo = ALV_Digitaal). Git-init-commando's aangeleverd. → READY_FOR_DEV.
- 2026-08-10 — Codex: repo/init/origin hersteld; taak 10.2 lokaal groen met rood+groen bewijs. → READY_FOR_TEST.
