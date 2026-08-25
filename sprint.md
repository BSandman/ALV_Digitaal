# sprint.md — Sprint 14: veilige sprintactivatie + P0a-herstel

**Doel:** de control-plane vertrouwbaar maken. De Codex-review (24-08) legde een structurele **bootstrap-cirkel** bloot: de baton werd rechtstreeks op `main` gewijzigd (buiten de GitSteward om), config-herstel toegewezen aan Codex terwijl zijn watcher die config vóór de start valideert, en overgedragen met een open PR (#24). De kern is niet nóg een regel maar één machine-afgedwongen, atomische **`git_steward activate-sprint`**: Claude levert een kandidaat-manifest, de steward bewíjst op verse `main` dat de overgang haalbaar is vóór Codex de baton krijgt. Daarnaast: context-afhankelijke coherentie, concrete fouten doorgeven, Lane A onbevoorrecht, CAS-baton volledige swap. Ontwerp: **ADR-0026** + **ADR-0000**. **Native auto-merge blijft OFF.**

> **Bron van waarheid:** `config/pipeline-sprint.json` (sprint/branch/versie/tag); `sprint.md` en `handoff.md` verwijzen. Spec + acceptatiecriteria: `docs/gates/Codex-taak-sprint-14-p0a-herstel-coherentie.md`.

> **Eenmalige begeleide bridge.** `activate-sprint` bestaat nog niet, dus deze sprint wordt één keer attended geactiveerd (oud-schema config, guard groen geverifieerd) — daarna bouwt Codex de geautomatiseerde versie en is elke volgende sprint verplicht via de command. Branch = **`agent/sprint-14-veilige-activatie`**, vanaf de actuele `main`; watchers op `main`; `--max-turns 1`; merge attended exact-op-SHA. Bruikbare broncode uit `9243eec` wordt selectief gecherry-pickt (geen oude control-plane).

## Cadans — per blok
| Blok | Rol | Watcher | Inhoud |
|---|---|---|---|
| 1 | **Codex** (dev) | `--role codex` (op main) | `activate-sprint`, context-coherentie, concrete fouten, Lane A, CAS full-swap; PR op `agent/sprint-14-veilige-activatie` |
| 2 | *auto* | — | Lane A CI-gates + Gemini-review op de PR |
| 3 | **Claude** (validatie) | Cowork | Toets tegen ADR-0026 + ADR-0000 + acceptatiecriteria |
| 4 | **Bas** (preflight) | handmatig | `p0a-admin-preflight` (indien in scope) |
| 5 | **Mistral** (integratie) | `--role mistral` (op main) | Gates; **attended exact-SHA-merge**; geen deploy |

## Scope (in) — kern
`git_steward activate-sprint` (atomische, bewezen sprintstart), context-afhankelijke coherentie (activatie/feature/PR-CI), concrete guard-/activatiefouten doorgeven, Lane A onbevoorrechte PR-CI, CAS-baton volledige swap. **Verplicht vóór integratie:** `p0a-admin-preflight` (App-token, per-run gemint). **Mag naar Sprint 15:** nood-rebase-SHA-rollen.

## Scope (uit) — P0b of later
Native auto-merge activeren, echte Gemini-verdict-check, PII context-aware gate, Environment/deploy-poort, dedup-notifier, lease, labels-migratie.

## Definition of done (P0a-afronding; P0b-go pas geldig mét admin-preflight)
`activate-sprint` bewezen (inconsistente kandidaat faalt met álle concrete redenen tegelijk, publiceert niets; groene kandidaat publiceert config/sprint/progress/handoff atomair + `READY_FOR_DEV`; Claude kan `READY_FOR_DEV` niet buiten de command zetten); context-coherentie in drie modi groen; concrete fout in `note`+`autorun.log`; Lane A groen zónder admin-lees; CAS full-swap bewezen; alles consistent Sprint 14; **geen** actieve native auto-merge. `npm run check` + Python-tests + gates + Gemini groen. Geen deploy; geen productcode buiten de PR.
