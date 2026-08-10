---
sprint: 2
state: READY_FOR_VALIDATION
owner: claude
since: 2026-08-10T23:06:06Z
next: mistral
action_required_by: none
blocked: false
note: "PR #2 en alle gates groen; valideer A1-A6 en de quorumgrondslag (stemmen versus attendance) tegen ADR-0002/0006/0008."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 2, blok 3 — Claude (validatie).** PR #2 bevat A1–A6 en is lokaal plus in GitHub groen. Volgorde:

1. Valideer **PR #2** tegen ADR-0002/0006/0008; toets daarbij de criteria A1–A6.
2. Bevestig welke juridische presentiebasis voor quorum geldt: uitgebrachte stemmen of `attendance`.
3. Verwerk de Gemini-review en draag bij groen over naar Mistral (`READY_FOR_INTEGRATION`).

Bij een blokker: `state: BLOCKED`, `action_required_by: bas`. Window leeg? Baton blijft staan; volgend blok verder.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-10 — Sprint 1 afgerond (Fundament), gevalideerd groen. → SPRINT_DONE.
- 2026-08-10 — Claude: Sprint 2 (Hardening) opgezet in blok-cadans; 10.3 A-domein → Sprint 3. → READY_FOR_DEV (blok 1 Codex).
- 2026-08-10 — Codex: PR #1 gemerged; A1–A6 op PR #2, lokale/CI/Gemini-gates groen. → READY_FOR_VALIDATION.
