# sprint.md — Sprint 6: rol-runners voor begeleide autorun

**Doel:** de bestaande autorun-harness voorzien van concrete, geteste runners voor Codex, Claude en Mistral, zodat per rol één begeleide beurt met `--max-turns 1` kan worden bewezen. Besluit: **ADR-0019**. Spec: **`docs/gates/Codex-taak-rol-runners.md`**.

## Cadans — per sub-taak

| Blok | Rol | Watcher | Inhoud |
|---|---|---|---|
| 1 | **Codex** (dev) | `--role codex` | Mistral-integratierunner, Codex-/Claude-ARGV, config, runbook en contracttests; PR |
| 2 | *auto* | — | CI-gates + Gemini-review |
| 3 | **Claude** (validatie) | `--role claude` | Toets de drie runners tegen ADR-0019/0017 |
| 4 | **Bas + rollen** | attended | Eén echte, begeleide droogloop per beschikbare rol; geen deploy |

## Scope

- **Mistral:** deterministische Node-runner; vaste integratiechecks, PII-gate, baton/progress, commit+push; geen LLM in control-flow en nooit deploy.
- **Codex:** concrete non-interactieve `codex exec`-ARGV met begrensde schrijfrechten, geen prompts en stdin-context.
- **Claude:** concrete headless `claude --print`-ARGV met expliciete toegestane validatie-/Git-tools en zonder interactieve prompts.
- **Contract:** gecontroleerde repo-fixture bewijst geldige overgang, progress, commit+push, schoon/in-sync, determinisme en menselijke deploypoort; Gemini blijft lokaal verboden.

## Definition of done

- Drie concrete runner-ARGV-vormen en de deterministische Mistral-runner gebouwd en getest.
- `npm run check`, Python-tests, architectuur-, release- en PII-gates en Gemini-review groen.
- Claude valideert tegen ADR-0019; daarna pas een **begeleide** echte droogloop met Bas achter het scherm.

## Buiten scope

Onbemand/overnight aanzetten · automatische deploy · Gemini als lokale runner · nieuw product- of datamodelwerk.
