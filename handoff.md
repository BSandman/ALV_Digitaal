---
sprint: 8
state: READY_FOR_TEST
owner: gemini
since: 2026-08-16T12:31:17Z
next: gemini
action_required_by: none
blocked: false
note: "Sprint 8 formele Gemini-approval is gereed voor PR-review; alle lokale gates zijn groen en PIPELINE_AUTOMERGE blijft uit."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 8 — groen én formeel approved.** Ontwerp: aangescherpte **ADR-0023**; taak: `docs/gates/Codex-taak-gemini-approved-gate.md`.

**Opgeleverd op deze branch:** de Gemini-workflow eist één exacte verdict-trailer, bindt de review aan de gecontroleerde PR-head en plaatst via `pulls.createReview` een formele `APPROVE` of fail-closed `REQUEST_CHANGES`. De auto-advance-evaluator accepteert alleen een expliciete `APPROVED`-review van de verwachte GitHub Actions-bot naast de drie groene checks; de GraphQL-vorm `github-actions` en REST-vorm `github-actions[bot]` worden na beperkte suffixnormalisatie gelijk behandeld, terwijl iedere andere auteur no-op blijft. De attended-runbookstap voor GitHubs bot-approvalinstelling is toegevoegd. Bewijs: 83 Node-tests, 92 Python-tests, YAML-, handoff-, architectuur-, release- en PII-gates groen; de bekende Windows Job Object-timingrace was bij gerichte en volledige herhaling groen. `PIPELINE_AUTOMERGE` blijft uit; deploy/productie worden niet geraakt.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-12 — Codex: guardrails G1/G2/G3 gemerged (PR #9/#10/#11). Sprint 4 klaar.
- 2026-08-12 — Claude: G3 gevalideerd GROEN; autorun ontworpen (ADR-0017 + taakpakket). Bas: go for autorun. → READY_FOR_DEV (A1 Codex).
- 2026-08-12 — Codex: A1 op PR #12; e-mail/ntfy, dedup + proceslock, lokale config/state; 41+68 tests, gates en Gemini groen. → READY_FOR_VALIDATION.
- 2026-08-12 — Claude: A1 validatie GROEN; Codex merge PR #12 en bouw A2/A4.
- 2026-08-12 — Codex: PR #12 gemerged; A2/A4 op PR #13 met opt-in runner, kill-switch/caps/foutpoort en lokale meekijklaag; 61+68 tests, gates en Gemini groen. → READY_FOR_VALIDATION.
- 2026-08-12 — Codex: Sprint 6 rol-runners gebouwd; deterministische Mistral-integratie + menselijke deploypoort, concrete Codex-/Claude-ARGV en fixturecontracttests; 72+69 tests en alle lokale gates groen. → READY_FOR_TEST.
- 2026-08-13 — Codex: PR #15 gemerged; Sprint 7 geclaimd op `agent/sprint-7-pr-auto-advance`; kill-switch blijft uit. → DEV_IN_PROGRESS.
- 2026-08-13 — Codex: auto-advance gebouwd met vertrouwde-main-evaluatie, exacte check/workflowbinding, head-SHA-binding, idempotente batontransitie en hersteltrigger; 82+80 tests en alle lokale gates groen. → READY_FOR_TEST.
- 2026-08-13 — Codex: Gemini-passfollow-up dekt conflicterende retried checks, dismissed/actieve wijzigingsreviews, fork-identiteit, BLOCKED/READY_FOR_DEV, lege/corrupte handoff en notesanitisatie; fail-closed gedrag bevestigd. → READY_FOR_TEST.
- 2026-08-13 — Codex: finale TOCTOU-hardening herleest en herevalueert gates/reviews direct voor merge; mergefout of gewijzigde voorwaarde blokkeert expliciet iedere batonstap. → READY_FOR_TEST.
- 2026-08-14 — Codex: alle `main`-writes repositorybreed geserialiseerd; lange checklijst en UTF-8-BOM/CRLF-transitie als regressietests toegevoegd. 82+86 tests en lokale gates groen. → READY_FOR_TEST.
- 2026-08-16 — Codex: PR #16 stond reeds gemerged op `main`; Sprint 8 bouwt formele Gemini-review + verplichte verwachte bot-approval. 83+91 tests en lokale gates groen. → READY_FOR_TEST.
- 2026-08-16 — Codex: echte PR #17-approval bevestigde GitHubs loginvarianten; optionele terminale `[bot]` wordt genormaliseerd, beide geldige vormen plus vreemde-auteur-no-op zijn getest. 83+92 tests groen. → READY_FOR_TEST.
