---
sprint: 6
state: READY_FOR_TEST
owner: gemini
since: 2026-08-12T22:49:02Z
next: claude
action_required_by: none
blocked: false
note: "Sprint 6 rol-runners staan op PR: contractfixtures en alle lokale gates zijn groen; Gemini reviewt, deploy en autorun blijven uit."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 6 — concrete rol-runners voor begeleide autorun.** Ontwerp: **ADR-0019**; taak: `docs/gates/Codex-taak-rol-runners.md`.

**Opgeleverd op deze PR:** een deterministische Mistral-integratierunner met vaste Python-/app-/PII-gates, geldige baton/progress-commits en push; een menselijke `BLOCKED`-poort zodra deploy nodig is; concrete headless ARGV voor Codex en Claude; bijgewerkt attended-first runbook en Sprint 6-plan. Gecontroleerde repo-fixtures bewijzen schoon/in-sync, determinisme en geen deploy; Gemini blijft lokaal verboden. Bewijs: 72 Node-tests, 69 Python-tests, architectuur-, release-, handoff- en PII-gates groen. Autorun, overnight en deploy zijn niet aangezet. Gemini reviewt de PR; daarna Claude-validatie tegen ADR-0019/0017.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-12 — Codex: guardrails G1/G2/G3 gemerged (PR #9/#10/#11). Sprint 4 klaar.
- 2026-08-12 — Claude: G3 gevalideerd GROEN; autorun ontworpen (ADR-0017 + taakpakket). Bas: go for autorun. → READY_FOR_DEV (A1 Codex).
- 2026-08-12 — Codex: A1 op PR #12; e-mail/ntfy, dedup + proceslock, lokale config/state; 41+68 tests, gates en Gemini groen. → READY_FOR_VALIDATION.
- 2026-08-12 — Claude: A1 validatie GROEN; Codex merge PR #12 en bouw A2/A4.
- 2026-08-12 — Codex: PR #12 gemerged; A2/A4 op PR #13 met opt-in runner, kill-switch/caps/foutpoort en lokale meekijklaag; 61+68 tests, gates en Gemini groen. → READY_FOR_VALIDATION.
- 2026-08-12 — Codex: Sprint 6 rol-runners gebouwd; deterministische Mistral-integratie + menselijke deploypoort, concrete Codex-/Claude-ARGV en fixturecontracttests; 72+69 tests en alle lokale gates groen. → READY_FOR_TEST.
