---
sprint: 7
state: READY_FOR_TEST
owner: gemini
since: 2026-08-13T22:56:41Z
next: gemini
action_required_by: none
blocked: false
note: "Sprint 7 auto-advance is gereed voor PR-review; alle lokale gates zijn groen en PIPELINE_AUTOMERGE blijft uit."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 7 — PR-gate auto-advance.** Ontwerp: **ADR-0023**; taak: `docs/gates/Codex-taak-pr-auto-advance.md`.

**Opgeleverd op deze branch:** een fail-safe GitHub Action die uitsluitend bij `PIPELINE_AUTOMERGE=on`, een interne pipelinebranch/label, de drie vereiste checks uit hun verwachte workflows, geen wijzigingsverzoek en een mergeklare PR mag squash-mergen — direct vóór de merge opnieuw beoordeeld en gebonden aan exact de gecontroleerde head-SHA. Daarna zet een apart, idempotent en dependency-vrij script alleen `READY_FOR_TEST/gemini` door naar `READY_FOR_VALIDATION/claude`; elke vervolgstap vereist expliciet succes van de mergeketen. Onbekende, ongeldige, incomplete of reeds verwerkte staten zijn no-op; een handmatige hersteltrigger kan na een geslaagde merge uitsluitend de baton alsnog doorzetten. Bewijs: 82 Node-tests, 84 Python-tests, YAML-, handoff-, architectuur-, release- en PII-gates groen. `PIPELINE_AUTOMERGE` bestaat nog niet en is dus fail-safe uit; deploy/productie worden niet geraakt.

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
