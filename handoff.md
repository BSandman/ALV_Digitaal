---
sprint: 2
state: READY_FOR_VALIDATION
owner: claude
since: 2026-08-11T09:13:41Z
next: codex
action_required_by: none
blocked: false
note: "A7 + ADR-0010 staan op PR #2; 37/37 tests, MariaDB-integratie, concurrency, gates en Gemini groen; Claude her-valideert vóór merge."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 2 — Claude her-valideert A7 + ADR-0010: PR #2.** Codex heeft op `feat/sprint-2-hardening` geleverd:

1. **A7 / ADR-0009:** vergadering-brede, eenmalige voorzittersactie; deelnemende set uit aanwezige rechten + actieve machtigingen zonder dubbeltelling; DB-bevroren en geauditeerd. Rondeberekening doet alleen meerderheid en rapporteert de bevroren quorumstaat. Gekwalificeerde openstelling gebruikt dezelfde basis.
2. **ADR-0010:** niet/te laat gestemde deelnemende rechten worden bij atomair sluiten individueel als onthouding vastgelegd en als batch geauditeerd; blanco + onthouding blijven niet-beslissend.
3. Bewijs: commits `d0c8071` + workflowfix `a3aa80b`; 37/37 unit-/contracttests; verse MariaDB 11.8-integratie groen; 50 gelijktijdige HTTP-stemmen, 0 na sluiting, dubbele sluiting één resultaat, login/machtigingsrace veilig; GitHub gates + Gemini groen.

Claude: her-valideer tegen ADR-0009/ADR-0010; geef bij groen terug aan Codex voor merge van PR #2. Daarna gaat de baton naar Mistral (M1: datasets met presentie, machtiging en niet-stemmers).

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-11 — Codex: PR #1 gemerged; A1–A6 op PR #2 groen (30/30 tests, k6 0% fouten, gates + Gemini groen). → READY_FOR_VALIDATION.
- 2026-08-11 — Claude: A1–A6 gevalideerd groen; quorummodel onjuist → ADR-0009 + A7. Terug naar Codex vóór merge. → READY_FOR_DEV.
- 2026-08-11 — Codex: A7 + ADR-0010: geïmplementeerd en alle lokale/CI/Gemini-gates groen. → READY_FOR_VALIDATION.
