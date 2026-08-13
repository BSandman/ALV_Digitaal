---
sprint: 7
state: DEV_IN_PROGRESS
owner: codex
since: 2026-08-13T22:47:34Z
next: gemini
action_required_by: none
blocked: false
note: "Sprint 7 gestart: Codex bouwt de fail-safe PR-gate auto-advance; kill-switch blijft uit en deploy blijft menselijk."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 7 — PR-gate auto-advance.** Ontwerp: **ADR-0023**; taak: `docs/gates/Codex-taak-pr-auto-advance.md`.

Codex bouwt een fail-safe GitHub Action die uitsluitend bij `PIPELINE_AUTOMERGE=on`, een pipelinebranch/label, alle vereiste groene checks, geen wijzigingsverzoek en een mergeklare PR mag squash-mergen. Daarna zet een apart, idempotent en dependency-vrij script `READY_FOR_TEST` door naar `READY_FOR_VALIDATION`. Bij twijfel gebeurt niets; deploy en productie worden nooit geraakt. De switch blijft tijdens bouw en review uit.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-12 — Codex: guardrails G1/G2/G3 gemerged (PR #9/#10/#11). Sprint 4 klaar.
- 2026-08-12 — Claude: G3 gevalideerd GROEN; autorun ontworpen (ADR-0017 + taakpakket). Bas: go for autorun. → READY_FOR_DEV (A1 Codex).
- 2026-08-12 — Codex: A1 op PR #12; e-mail/ntfy, dedup + proceslock, lokale config/state; 41+68 tests, gates en Gemini groen. → READY_FOR_VALIDATION.
- 2026-08-12 — Claude: A1 validatie GROEN; Codex merge PR #12 en bouw A2/A4.
- 2026-08-12 — Codex: PR #12 gemerged; A2/A4 op PR #13 met opt-in runner, kill-switch/caps/foutpoort en lokale meekijklaag; 61+68 tests, gates en Gemini groen. → READY_FOR_VALIDATION.
- 2026-08-12 — Codex: Sprint 6 rol-runners gebouwd; deterministische Mistral-integratie + menselijke deploypoort, concrete Codex-/Claude-ARGV en fixturecontracttests; 72+69 tests en alle lokale gates groen. → READY_FOR_TEST.
- 2026-08-13 — Codex: PR #15 gemerged; Sprint 7 geclaimd op `agent/sprint-7-pr-auto-advance`; kill-switch blijft uit. → DEV_IN_PROGRESS.
