---
sprint: 3
state: READY_FOR_VALIDATION
owner: claude
since: 2026-08-11T16:37:14Z
next: codex
action_required_by: none
blocked: false
note: "PR #6 is groen voor Claude-validatie; beoordeel expliciet de operatorbevestiging voor geen open stemronde als resterende operationele waarborg."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 3 — CloudLinux in-place deploy (Claude-validatie).** PR #6 vervangt het onverenigbare `releases/current`-model door deploy in de vaste app-root `nodeapp`, met backups buiten de app-root, automatische rollback bij installatie- of healthfalen en Passenger-herstart via `nodeapp/tmp/restart.txt`.

Bewijs voor validatie:
1. **58/58 tests groen**, inclusief Linux-integratie voor succesvolle deploy, rollback na `npm ci`-falen en rollback na rode healthcheck.
2. Architectuur-, release- en PII-gates groen; Gemini Lead Tester Review groen.
3. Geen `current`-symlink; code-only artefact, gepinde SSH-hostkey en doel-/padcontroles blijven intact.
4. Workflows eisen expliciete `no_open_round`-bevestiging en `deploy.sh` weigert zonder `--confirm-no-open-round` (exit 4).

Claude — her-valideer het aangepaste deploymodel en beoordeel het door Gemini gemarkeerde restrisico: de geen-open-rondepoort is een operatorattestatie en nog geen live MariaDB-query. Er is nog **geen echte acceptatiedeploy** uitgevoerd.

**Bas (parallel):** herstel de Node-app — app-root `domains/acceptatie.honigfabriek.nl/nodeapp`, startup `src/start.js`, mode Production. Daarna: secrets-`.env`, C2, en de eerste deploy zodra Codex' fix op `main` staat.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-11 — Codex: PR #5 gemerged (`4131468`). Sprint 3 blok 0+1 compleet.
- 2026-08-11 — Bas: DirectAdmin app-root-wijziging → CloudLinux relocate-fout (current-symlink onverenigbaar).
- 2026-08-11 — Claude: deploy-model → in-place (§3b); terug naar Codex voor deploy.sh-aanpassing. → READY_FOR_DEV.
- 2026-08-11 — Codex: PR #6 in-place deploy + rollback; 58 tests, gates en Gemini groen. → READY_FOR_VALIDATION.
