---
sprint: 2
state: DEV_IN_PROGRESS
owner: codex
since: 2026-08-10T22:24:02Z
next: claude
action_required_by: none
blocked: false
note: "Sprint 2 hardening A1-A6 in uitvoering; PR #1 wordt eerst naar main gemerged."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 2, blok 1 — Codex (dev).** Start je watcher (`python scripts/watch_handoff.py --role codex`). Volgorde:

1. Merge **PR #1** → `main` (steward).
2. Branch `feat/sprint-2-hardening`.
3. Bouw **A1–A6** uit `sprint.md` (row-level autorisatie, `NO_BACKSLASH_ESCAPES`, exacte rekenkunde, auth-hardening, machtiging-vervalt-bij-login, server-relatieve sluit-timer). Toets tegen ADR-0002/0006/0008.
4. Open een PR (gates + Gemini-review draaien automatisch) en zet daarna `state: READY_FOR_VALIDATION`, `owner: claude`.

Bij een blokker: `state: BLOCKED`, `action_required_by: bas`. Window leeg? Baton blijft staan; volgend blok verder.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-10 — Sprint 1 afgerond (Fundament), gevalideerd groen. → SPRINT_DONE.
- 2026-08-10 — Claude: Sprint 2 (Hardening) opgezet in blok-cadans; 10.3 A-domein → Sprint 3. → READY_FOR_DEV (blok 1 Codex).
