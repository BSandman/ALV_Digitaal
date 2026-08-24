# sprint.md — Sprint 14: P0a-herstel + coherentie-gate

**Doel:** de P0a-herstelronde na Sprint 13 (PR #23 mergde vroegtijdig door een bug; de fix-ronde bleek niet mergeklaar). We fixen de **klasse, niet het geval**: de verificatie in de juiste lane (onbevoorrechte PR-CI + aparte vertrouwde admin-preflight), de CAS-baton als één atomair object, het nood-rebasepad met eenduidige SHA-rollen, en — de kern — een **coherentie-gate** die luid faalt zodra projectonderdelen elkaar tegenspreken. Ontwerp: **ADR-0026** (CI/CD) + **ADR-0000** (coherentie). **Native auto-merge blijft OFF** (P0b).

> **Bron van waarheid:** `config/pipeline-sprint.json` is de autoriteit voor sprint/branch/versie/tag; dit bestand en `handoff.md` verwijzen daarnaar. Spec + acceptatiecriteria: `docs/gates/Codex-taak-sprint-14-p0a-herstel-coherentie.md`.

> **Zelf-modificerend + attended.** Vertak van de tip van `agent/sprint-13-cicd-p0a-fix1` (`9243eec`) — het goede werk uit findings 1–8 blijft behouden. Branch = **`agent/sprint-14-p0a-herstel-coherentie`**; watchers op **`main`**; `--max-turns 1`; merge attended exact-op-SHA.

## Cadans — per blok
| Blok | Rol | Watcher | Inhoud |
|---|---|---|---|
| 1 | **Codex** (dev) | `--role codex` (op main) | Lane A onbevoorrecht + `p0a-admin-preflight`, CAS full-swap, rebase-SHA-rollen, coherentie-gate, consistentie-herstel; PR op `agent/sprint-14-p0a-herstel-coherentie` |
| 2 | *auto* | — | Lane A CI-gates + Gemini-review op de PR |
| 3 | **Claude** (validatie) | Cowork | Toets tegen ADR-0026 + ADR-0000 + de acceptatiecriteria |
| 4 | **Bas** (preflight) | handmatig | `p0a-admin-preflight` draaien (App-token, `Administration: read`) |
| 5 | **Mistral** (integratie) | `--role mistral` (op main) | Gates; **attended exact-SHA-merge**; geen deploy |

## Scope (in) — acceptatiecriteria in het taakdoc
Lane A onbevoorrechte PR-CI-verificatie (geen branch-protection-lees daar), aparte vertrouwde `p0a-admin-preflight` (App-token, fail-closed, handmatig), CAS-baton volledige swap (finding-7 terug), nood-rebase met drie expliciete SHA-rollen + ancestry-check, coherentie-gate + single source of truth, alles consistent Sprint 14.

## Scope (uit) — P0b of later
Native auto-merge activeren, echte Gemini-verdict-check, PII context-aware gate, Environment/deploy-poort, dedup-notifier, lease, labels-migratie, `p0a-admin-preflight` automatisch draaien.

## Definition of done / go-no-go → P0b
Lane A groen zónder admin-lees; `p0a-admin-preflight` correct begrensd + fail-closed + inert-met-melding zonder secret; CAS full-swap bewezen (nieuwe re-read-test groen, oude veld-merge-test weg); nood-rebase drie-SHA-rollen + `--force-with-lease` dry-run bewezen; coherentie-gate faalt aantoonbaar bij tegenstrijdigheid en is groen bij consistente staat; alles consistent Sprint 14; **geen** actieve native auto-merge. `npm run check` + Python-tests + gates + Gemini groen. Geen deploy; geen productcode buiten de PR.
