# sprint.md — Sprint 4: Guardrails (prerequisites voor onbemande autorun)

**Doel:** de deterministische vangrails bouwen zodat de pijplijn straks **onbemand** kan draaien zonder dat een foute agent-beurt de gedeelde waarheid corrumpeert of wegloopt. Besluit: **ADR-0015**. Detailspec: **`docs/gates/Codex-taak-guardrails.md`**.

## Cadans — per sub-taak

| Blok | Rol | Watcher | Inhoud |
|---|---|---|---|
| 1 | **Codex** (dev) | `--role codex` | **G1** state-lint (CI-gate leidend + pre-commit hook); PR |
| 2 | *auto* | — | CI-gates + Gemini-review |
| 3 | **Claude** (validatie) | `--role claude` | Toets G1 tegen ADR-0015 + de statemachine |
| — | herhaal | | daarna **G2** (tail-context) en **G3** (infra-provisioning), elk dezelfde lus |

## Scope

- **G1 — State-lint (hoogste prio, de harde vangrail):** deterministische validatie van `handoff.md`-frontmatter tegen de statemachine (toegestane `state`/`owner`, verplichte sleutels, één owner, `BLOCKED ⇒ action_required_by: bas`). CI-gate die niet te omzeilen is, plus een lokale pre-commit hook voor zelfcorrectie.
- **G2 — Tail-context:** de watcher voedt de agent `handoff.md`+`sprint.md` volledig + alleen de laatste ~15 regels van `progress.md`. Bijbel blijft heel.
- **G3 — Idempotente infra-provisioning:** `provision_env.sh --target acceptatie|portaal` (secrets-`.env` met toegestane sleutels, geen `NODE_ENV`, `chmod 600` als laatste stap; nodevenv/Node-20-validatie; lsnode require-test). Voorkomt de drift van de vorige sprint.

## Definition of done

- G1, G2, G3 gebouwd, getest en door Claude groen gevalideerd; CI-gate G1 faalt aantoonbaar op een verzonnen state/ontbrekende sleutel.
- Daarna kan het **autorun-ontwerp** (onbemande watcher die de agent écht start, met signaal-lijn naar Bas) worden opgepakt.

## Buiten scope

Het autorun-ontwerp zelf (aparte ronde ná de guardrails) · het basisdatamodel/ADR-0014 + C2-data (aparte track, wacht op HonigParkeren) · de end-to-end testronde op acceptatie.
