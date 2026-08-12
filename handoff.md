---
sprint: 5
state: READY_FOR_VALIDATION
owner: claude
since: 2026-08-12T15:14:21Z
next: codex
action_required_by: none
blocked: false
note: "A3 klaar: lokale env-defaults + voorbeeldconfig + attended-first runbook; 65+68 tests en gates groen, autorun/deploy uit; valideer PR en plan begeleide droogloop."
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

**Opgeleverd op PR #12:** dependency-vrije notifier voor `BLOCKED`, `action_required_by: bas` en `SPRINT_DONE`; e-mail standaard en ntfy optioneel; state per overgang/kanaal atomisch en procesoverschrijdend vergrendeld; corrupte state faalt gesloten; lokale config en state blijven buiten Git. De state-lint ondersteunt nu de menselijke actiepoort buiten `BLOCKED`. Gemini-randgevallen voor parallelle aanroepen en inline configcommentaar zijn verwerkt. Bewijs: 41 Python-tests, 68 Node-tests, architectuur-/release-/PII-gates en twee GitHub/Gemini-runs groen. Claude valideert A1 tegen ADR-0017.

**Opgeleverd op PR #13:** A2 start alleen met `--autorun` een lokaal geconfigureerde rol-runner via veilige JSON-argv en begrensde stdin-context; Gemini blijft serverless. De kill-switch onderbreekt ook race-guard en actieve procesboom; `IN_PROGRESS` blijft hervatbaar. Loop- en wandklokcaps, geldige/schone/gepushte eindstate en fout→`BLOCKED`+notifier zijn afgedwongen. A4 levert atomische runtime-state, procesveilig activiteitenlog en `status.ps1`/lokaal `status.html` met GitHub-checks. Geen autorun of deploy is aangezet. Bewijs: 61 Python-tests, 68 Node-tests, dashboard met echte `gh`, architectuur-/release-/PII-gates en GitHub/Gemini groen. Claude valideert A2/A4 tegen ADR-0017; A3 blijft daarna over.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-12 — Codex: guardrails G1/G2/G3 gemerged (PR #9/#10/#11). Sprint 4 klaar.
- 2026-08-12 — Claude: G3 gevalideerd GROEN; autorun ontworpen (ADR-0017 + taakpakket). Bas: go for autorun. → READY_FOR_DEV (A1 Codex).
- 2026-08-12 — Codex: A1 op PR #12; e-mail/ntfy, dedup + proceslock, lokale config/state; 41+68 tests, gates en Gemini groen. → READY_FOR_VALIDATION.
- 2026-08-12 — Claude: A1 validatie GROEN; Codex merge PR #12 en bouw A2/A4.
- 2026-08-12 — Codex: PR #12 gemerged; A2/A4 op PR #13 met opt-in runner, kill-switch/caps/foutpoort en lokale meekijklaag; 61+68 tests, gates en Gemini groen. → READY_FOR_VALIDATION.
