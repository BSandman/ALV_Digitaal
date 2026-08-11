---
sprint: 3
state: READY_FOR_DEV
owner: codex
since: 2026-08-11T14:20:00Z
next: claude
action_required_by: none
blocked: false
note: "Sprint 3 (Acceptatie/10.3) - blok 0+1 Codex. Eerst docs-commit (ADR-0012 e.d.), dan deploy.sh + app-config voor acceptatie.honigfabriek.nl (DB-coords, SECRETS_FILE/ADR-0012, healthz). Zie sprint.md + docs/gates/Codex-Mistral-taak-10.3."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 3 — Acceptatie (10.3), blok 0+1 Codex.** Bas koos: A-domein eerst. Start je watcher (`python scripts/watch_handoff.py --role codex`).

1. **Blok 0 (klein):** commit de losse architect-docs naar `main` — ADR-0012, de DB-coördinaten in de 10.3-taak, en `bijbel.md`/`sprint.md`/`handoff.md`/`progress.md`/`Claude-validatie-sprint2.md`. Direct docs-commit is prima.
2. **Blok 1 (dev/infra):** wire `scripts/deploy.sh` + app-config voor **`acceptatie.honigfabriek.nl`** volgens `docs/gates/Codex-Mistral-taak-10.3_A-domein.md`: DB-coördinaten (`cn111993_acceptatie`), `SECRETS_FILE`-lezing (ADR-0012, `.env` buiten webroot), healthz, per-verbinding sql_mode, `X-Forwarded-For`. Open een PR; na gates + Gemini groen → `state: READY_FOR_VALIDATION`, `owner: claude`.

Bas doet parallel de DirectAdmin-/SSH-/secrets-`.env`-/echte-export-stappen uit `sprint.md`.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-11 — Codex: PR #4 gemerged (`8dc939a`). Sprint 2 compleet.
- 2026-08-11 — Claude: Sprint 2 afgerond; Bas koos Sprint 3 = 10.3 A-domein. → READY_FOR_DEV (blok 0+1 Codex).
