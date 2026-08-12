---
sprint: 5
state: DEV_IN_PROGRESS
owner: codex
since: 2026-08-12T11:42:28Z
next: claude
action_required_by: none
blocked: false
note: "Sprint 5 A1 geclaimd: Codex bouwt de gededupliceerde notifier met e-mail als standaardkanaal en optionele push."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 5 — Autorun, blok 1 Codex (A1 notifier).** Guardrails (G1/G2/G3) staan; nu de onbemande laag. Bas gaf "go for autorun". Ontwerp: **ADR-0017**.

Codex — bouw **A1 (notifier)** volgens `docs/gates/Codex-taak-autorun.md` §A1:
1. `scripts/notify_bas.py`: stuurt Bas **één** bericht per toestand-overgang bij `BLOCKED`, `action_required_by: bas`, `SPRINT_DONE`; gededupliceerd via een lokaal state-bestand.
2. Kanaal pluggbaar: e-mail default + optioneel push; config uit een **lokaal, niet-gecommit** bestand (nooit in Git).
3. Berichttekst = de handoff-`note` + state + directe aanwijzing (bv. "druk op Deploy acceptatie").
4. Tests: overgang → precies één bericht; herhaalde poll op dezelfde state → niets.

Open een PR; gates + Gemini; daarna Claude-validatie. Daarna A2 (autorun-`act()` + vangrails) en A3 (config/runbook).

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-12 — Codex: guardrails G1/G2/G3 gemerged (PR #9/#10/#11). Sprint 4 klaar.
- 2026-08-12 — Claude: G3 gevalideerd GROEN; autorun ontworpen (ADR-0017 + taakpakket). Bas: go for autorun. → READY_FOR_DEV (A1 Codex).
