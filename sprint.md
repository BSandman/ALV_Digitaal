# sprint.md — Sprint 5: Autorun (onbemande pijplijn met vangrails)

**Doel:** de watcher de agent écht laten starten i.p.v. alleen signaleren, met harde vangrails en één signaal-lijn naar Bas — zodat de keten onbemand loopt en Bas alleen bij een deploy/blokkade/go-no-go wordt gepingd. Besluit: **ADR-0017**. Spec: **`docs/gates/Codex-taak-autorun.md`**.

## Cadans — per sub-taak

| Blok | Rol | Watcher | Inhoud |
|---|---|---|---|
| 1 | **Codex** (dev) | `--role codex` | **A1** notifier (`notify_bas.py`, exception-based + dedup, e-mail/push); PR |
| 2 | *auto* | — | CI-gates + Gemini-review |
| 3 | **Claude** (validatie) | `--role claude` | Toets A1 tegen ADR-0017 |
| — | herhaal | | daarna **A2** (autorun-`act()` + vangrails) en **A3** (config + runbook) |

## Scope

- **A1 — Notifier (prio, de signaallaag):** één `notify_bas.py`, stuurt Bas één bericht per overgang bij `BLOCKED` / `action_required_by: bas` / `SPRINT_DONE`; gededupliceerd; kanaal e-mail default + optioneel push; config lokaal/niet-gecommit.
- **A2 — Autorun-`act()` + vangrails:** rol-runner-aanroep met begrensde context; kill-switch/pauze; loop-cap + max-wandklok; stop-on-error → `BLOCKED` + notify; deploy blijft mens (ADR-0013).
- **A3 — Config + runbook:** `autorun.toml`/env per rol; `AGENTS.md`-runbook (starten/pauzeren/killen, attended-first).

## Definition of done

- A1/A2/A3 gebouwd, getest, door Claude groen gevalideerd tegen ADR-0017.
- Een **begeleide** droogloop: minstens één autonome beurt-overgang, kill-switch aantoonbaar werkend, één notifier-bericht bij een `action_required_by: bas`-overgang, en de deploy-gate aantoonbaar mens-only.

## Buiten scope

Onbemand-overnight aanzetten (expliciete latere Bas-stap ná een paar begeleide cycli) · het basisdatamodel/ADR-0014 + C2-data · de frontend/auth-sprint.
