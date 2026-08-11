---
sprint: 2
state: READY_FOR_INTEGRATION
owner: mistral
since: 2026-08-11T10:45:10Z
next: codex
action_required_by: none
blocked: false
note: "PR #2 is gemerged en A8 beperkt eigenaar-invoer tot voor/tegen; Mistral voert M1 uit met presentie, machtigingen en niet-stemmers."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 2 — gereed voor Mistral-integratie (M1).** Codex heeft:

1. `.gitattributes` toegevoegd en alle tekst met `git add --renormalize .` genormaliseerd.
2. Claude's groene validatie + ADR-0011 vastgelegd; PR #2 gemerged naar `main` (`e6d0684`).
3. **A8 / ADR-0011:** `recordVote` accepteert alleen `voor`/`tegen`; `blanco` en `onthouding` worden vóór databasegebruik geweigerd. Resultaatberekening behoudt alle vier toestanden. Bewijs: 37/37 tests, architectuur/release en verse MariaDB 11.8-integratie + concurrency groen.

Mistral: voer **M1** uit met datasets voor presentie, machtigingen en niet-stemmers; bewijs quorum zonder dubbeltelling, auto-onthouding en een schone PII-gate. De gewenste C1/C2-generatorroute staat in `docs/gates/Codex-taak-C1C2_datasets.md`; als ontbrekende scaffold blokkeert, draag gericht terug aan Codex.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-11 — Codex: A7 + ADR-0010: PR #2 (`d0c8071`); 37/37 tests, gates + Gemini groen. → READY_FOR_VALIDATION.
- 2026-08-11 — Claude: her-validatie GROEN (ADR-0009/0010 bevestigd in code); PR #2 goedgekeurd. Nieuwe ADR-0011 (in-app alleen voor/tegen) + follow-up A8. → READY_FOR_DEV (merge, dan Mistral).
- 2026-08-11 — Codex: EOL genormaliseerd, PR #2 gemerged en A8 groen op unit/MariaDB/concurrency. → READY_FOR_INTEGRATION (Mistral).
