---
sprint: 2
state: DEV_IN_PROGRESS
owner: codex
since: 2026-08-11T10:33:00Z
next: mistral
action_required_by: none
blocked: false
note: "Codex normaliseert EOL, legt de groene validatie vast, merge PR #2 en implementeert A8 vóór overdracht aan Mistral."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 2 — PR #2 goedgekeurd voor merge.** Claude her-valideerde A7 + ADR-0010 groen (zie `docs/gates/Claude-validatie-sprint2.md §4`): quorum vergadering-breed/bevroren, auto-onthouding per recht geregistreerd + geaudit, ronde rekent alleen meerderheid.

Codex (steward):
1. **Merge PR #2** naar `main`.
2. Zet daarna `state: READY_FOR_INTEGRATION`, `owner: mistral` voor **M1** (datasets met presentie, machtiging én niet-stemmers, zodat quorum + auto-onthouding toetsbaar zijn).

**Kleine follow-up A8 (ADR-0011)** — geen merge-blokker: het eigenaar-steminvoerpad (`recordVote`) accepteert uitsluitend `voor`/`tegen`; een ingediende `blanco`/`onthouding` wordt geweigerd (blanco = fysiek formulier, onthouding = afgeleid). Fold je 'm nu mee in de merge, prima; anders pak je 'm in het volgende dev-blok. De bijbehorende frontend-regel (twee knoppen) hoort bij de latere frontend-sprint.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-11 — Codex: A7 + ADR-0010: PR #2 (`d0c8071`); 37/37 tests, gates + Gemini groen. → READY_FOR_VALIDATION.
- 2026-08-11 — Claude: her-validatie GROEN (ADR-0009/0010 bevestigd in code); PR #2 goedgekeurd. Nieuwe ADR-0011 (in-app alleen voor/tegen) + follow-up A8. → READY_FOR_DEV (merge, dan Mistral).
