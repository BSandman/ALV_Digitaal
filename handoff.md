---
sprint: 3
state: READY_FOR_DEV
owner: codex
since: 2026-08-11T14:20:00Z
next: claude
action_required_by: none
blocked: false
note: "Platform-vondst: current-symlink deploy botst met CloudLinux Node Selector (relocate-into-itself). Codex: pas deploy.sh aan naar IN-PLACE deploy in de app-root (nodeapp) + backup-rollback + restart.txt; geen current-symlink. Bas herstelt de Node-app parallel (app-root nodeapp, startup src/start.js)."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 3 — deploy-model aanpassen (Codex).** Bij de eerste opzet bleek het `releases/current`-symlinkmodel te botsen met CloudLinux Node Selector: de app-root kan niet naar zijn eigen submap (`nodeapp/current`) worden verplaatst. Zie `docs/gates/Claude-validatie-sprint3.md §3b`.

Codex — pas `scripts/deploy.sh` (+ de workflows waar nodig) aan:
1. **In-place deploy** in de door CloudLinux beheerde app-root (`REMOTE_DIR = .../nodeapp`): rsync de code-only release naar de app-root, `npm ci --omit=dev`, Passenger-herstart via `nodeapp/tmp/restart.txt`.
2. **Rollback** via een getimestampte backup van de vorige app-root (geen `current`-symlink).
3. Healthcheck ná deploy blijft. Deploy tijdens een open stemronde blijft een no-go.
Open een PR; gates + Gemini; daarna Claude her-valideert.

**Bas (parallel):** herstel de Node-app — app-root `domains/acceptatie.honigfabriek.nl/nodeapp`, startup `src/start.js`, mode Production. Daarna: secrets-`.env`, C2, en de eerste deploy zodra Codex' fix op `main` staat.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-11 — Codex: PR #5 gemerged (`4131468`). Sprint 3 blok 0+1 compleet.
- 2026-08-11 — Bas: DirectAdmin app-root-wijziging → CloudLinux relocate-fout (current-symlink onverenigbaar).
- 2026-08-11 — Claude: deploy-model → in-place (§3b); terug naar Codex voor deploy.sh-aanpassing. → READY_FOR_DEV.
