---
sprint: 4
state: READY_FOR_VALIDATION
owner: claude
since: 2026-08-12T10:28:41Z
next: codex
action_required_by: none
blocked: false
note: "PR #10 G2 klaar: volledige handoff/sprint/bijbel + standaard laatste 15 progressregels, configureerbaar; 26+61 tests en gates/Gemini groen."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 4 — Guardrails, blok 1 Codex (G1).** Acceptatie is live (Sprint 3 kern binnen); nu de vangrails richting onbemand. Bas koos het guardrails-pakket.

Codex — bouw **G1 (state-lint)** volgens `docs/gates/Codex-taak-guardrails.md` §G1 en ADR-0015:
1. Validator-script (dependency-vrij) dat `handoff.md`-frontmatter toetst: `state`/`owner` uit de toegestane sets, verplichte sleutels, één owner, `BLOCKED ⇒ action_required_by: bas`, correcte afsluiting.
2. **CI-gate (leidend)** in `ci.yml` op PR + push naar `main`.
3. **Lokale pre-commit hook** (`.githooks/`) voor snelle zelfcorrectie.
4. Tests: geldige handoff groen; verzonnen state / ontbrekende sleutel / twee owners rood.

Open een PR; gates + Gemini; daarna Claude-validatie. Daarna G2 en G3 in dezelfde lus.

**Opgeleverd op PR #9:** dependency-vrije validator met strikte platte frontmatter, state↔owner-consistentie, tijdzone- en blokkadesemantiek; aparte leidende CI-job; lokale hook met werkende Python-selectie op Windows/Git Bash en Linux. Bewijs: 21 gerichte rood/groen-tests (incl. CRLF/BOM/quotes/ISO/lijst/map/leeg bestand), 61/61 regressies, GitHub-gates en Gemini groen. Claude valideert G1 tegen ADR-0015.

**Opgeleverd op PR #10:** G2 bouwt alleen bij een echte beurt een begrensde context met volledige `handoff.md`, `sprint.md` en `bijbel.md`, plus standaard de laatste 15 regels van `progress.md`; instelbaar via `--progress-tail`. Bewijs: 26 Python-guardrailtests, 61/61 regressies en GitHub-gates + Gemini groen. Claude valideert G2 tegen ADR-0015.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-12 — MIJLPAAL: acceptatie live (deploy + healthz groen). Sprint 3 kern binnen.
- 2026-08-12 — Claude: guardrails-pakket + ADR-0015 klaargezet; Bas koos Sprint 4 = Guardrails. → READY_FOR_DEV (G1 Codex).
- 2026-08-12 — Codex: G1 op PR #9; 21 parsertests + 61 regressies, aparte state-gate en Gemini groen. → READY_FOR_VALIDATION.
- 2026-08-12 — Codex: PR #9 gemerged (`43478af`); G2 op PR #10 met begrensde, configureerbare context; 26+61 tests en gates/Gemini groen. → READY_FOR_VALIDATION.
