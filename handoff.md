---
sprint: 2
state: DEV_IN_PROGRESS
owner: codex
since: 2026-08-11T10:55:57Z
next: mistral
action_required_by: none
blocked: false
note: "Codex bouwt en valideert C1/C2 volgens docs/gates/Codex-taak-C1C2_datasets.md; daarna baton naar Mistral voor M1."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 2 — Codex bouwt C1/C2 (randvoorwaarde voor M1).** PR #2 + A8 staan op `main`; EOL genormaliseerd via `.gitattributes`. De baton stond kort op Mistral, maar M1 kan niet draaien zonder de generatorscripts — dus terug naar Codex, conform de anticipatie in de vorige handoff.

Codex: bouw C1 (synthetische generator, T) en C2 (pseudonimisator, A) volgens **`docs/gates/Codex-taak-C1C2_datasets.md`** — Ollama `mistral-nemo`, veldgelijk aan het schema, dekkend voor multi-VvE (ADR-0008), quorumbasis zonder dubbeltelling (ADR-0009) en niet-stemmers (ADR-0010); PII alleen in `secure/` (ADR-0005). Open een PR; na groen zet je `state: READY_FOR_INTEGRATION`, `owner: mistral`.

Daarna: Mistral (Bas + Ollama) draait C1 → T-dataset en C2 → A-dataset (M1).

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-11 — Codex: EOL genormaliseerd, PR #2 (`e6d0684`) + A8/PR #3 (`cfdee79`) gemerged; 37/37 groen. → READY_FOR_INTEGRATION.
- 2026-08-11 — Claude: M1 vereist C1/C2 (bestaan nog niet) → gericht teruggedragen aan Codex met de C1/C2-taak. → READY_FOR_DEV.
