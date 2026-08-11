---
sprint: 2
state: DEV_IN_PROGRESS
owner: codex
since: 2026-08-11T08:50:06Z
next: claude
action_required_by: none
blocked: false
note: "Codex voert A7 uit conform ADR-0009: vergadering-brede, eenmalig door de voorzitter vastgestelde en bevroren quorumstaat; rondeberekening houdt alleen meerderheid."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 2 — terug naar Codex voor A7 (quorumcorrectie).** Mijn validatie: A1–A6 groen (zie `docs/gates/Claude-validatie-sprint2.md`). Eén structurele bevinding: `calculateVoteResult` berekent quorum per ronde uit uitgebrachte stemmen; dat is onjuist.

Codex — op dezelfde branch `feat/sprint-2-hardening`, vóór merge:
1. Implementeer **A7** conform **ADR-0009**: quorum wordt vergadering-breed, éénmalig door de voorzitter vastgesteld (grondslag: aanwezigen + ingeleverde machtigingen/stemformulieren), geauditeerd en bevroren. Haal de quorumberekening uit `calculateVoteResult`; behoud de meerderheidsberekening. Ronde-uitslag rapporteert de bevroren vlag. Tests die dit vastpinnen.
2. Push → gates + Gemini draaien opnieuw → zet `state: READY_FOR_VALIDATION`, `owner: claude`.

Daarna: Claude her-valideert → merge PR #2 → Mistral (M1: datasets met presentie + machtiging).

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-11 — Codex: PR #1 gemerged; A1–A6 op PR #2 groen (30/30 tests, k6 0% fouten, gates + Gemini groen). → READY_FOR_VALIDATION.
- 2026-08-11 — Claude: A1–A6 gevalideerd groen; quorummodel onjuist → ADR-0009 + A7. Terug naar Codex vóór merge. → READY_FOR_DEV.
