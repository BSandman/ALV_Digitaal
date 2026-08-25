# Codex-taak — Sprint 14: veilige sprintactivatie + P0a-herstel

**Ontwerp:** ADR-0026 (CI/CD) + ADR-0000 (coherentie) + Codex-review 24-08. **Zelf-modificerend, attended.** Herstelronde na Sprint 13. De review legde een **structurele bootstrap-cirkel** bloot: de gewenste eindtoestand werd beschreven, maar de overgang vanaf de actuele toestand niet bewezen — Claude wijzigde de baton rechtstreeks op `main` (buiten de GitSteward om), gaf config-herstel aan Codex terwijl Codex' watcher die config vóór de start valideert, en droeg over met een open PR (#24). **De kern van deze sprint is dat niet nóg een regel oplost, maar een machine-afgedwongen atomische sprintactivatie.** **Native auto-merge blijft OFF.**

**Raakt:** ADR-0026 · ADR-0025 (GitSteward) · ADR-0023 (PR-gate) · ADR-0015 (guardrails) · ADR-0000 (coherentie) · `scripts/git_steward.py` (nieuw: `activate-sprint`) · `scripts/pipeline_guard.py` · `scripts/watch_handoff.py` · nieuw `scripts/check_coherence.py` · `.github/workflows/ci.yml` · `config/pipeline-sprint.json` · `sprint.md` · `handoff.md` · `progress.md`. Loop deze keten af: de sprintactivatie, de baton-transitie en de bron-van-waarheid (`config`) grijpen in elkaar — afwijken van één stuk breekt de start.

## Werkwijze — veilige herstelroute (Codex-review)
Niet rechtstreeks vanaf `9243eec` vertakken (dat sleept de verouderde control-plane mee). Route:
1. **PR #24 sluiten als *superseded*** — menselijke randvoorwaarde (Bas), vóór activatie.
2. **Eenmalige begeleide bridge (expliciete uitzondering).** Er zijn twee bootstrap-cirkels: (a) Codex moet config repareren maar de watcher valideert config vóór de start; (b) de nieuwe infra-config vereist de nieuwe guard die Codex pas bouwt. Doorbreken zonder productcode buiten een PR: zet op de actuele `main` (`bfd9e95`) een **oud-schema-consistente** Sprint 14-kandidaat (config `sprint:14` + doelbranch + `0.2.0`/`v0.2.0`, plus `sprint.md`/`handoff.md`) in één commit, **verifieer de oude guard groen** (handmatig, met Bas erbij) en zet dán pas `READY_FOR_DEV`. Codex' **eerste** deliverable is `activate-sprint` (nieuw-schema-bewust) + migratie van config naar `infra`-schema op de branch; vanaf Sprint 15 verplicht via de command.
3. **Nieuwe Sprint 14-branch** `agent/sprint-14-veilige-activatie` vanaf de geactiveerde `main`.
4. **Alleen de bruikbare broncodewijzigingen van `9243eec` cherry-picken** (`pipeline_guard.py`, `git_steward.py`, `watch_handoff.py`, `notify_bas.py`, `ci.yml`, tests) — **niet** de oude `handoff.md`/`progress.md`/`sprint.md`/`config` uit de fixbranch.
5. Watchers op **`main`**, attended, `--max-turns 1`; merge attended exact-op-SHA (`PIPELINE_AUTOMERGE` off).

## Scope (in) — kern: control-plane veilig maken

### 1. `git_steward activate-sprint` — atomische, bewezen sprintstart (de kern)
Claude levert alleen een **kandidaat-sprintmanifest** aan; Claude zet daarna **nooit meer zelf** `READY_FOR_DEV`. De command draait op een **verse `main`-snapshot** en voert alle controles uit:
1. vorige sprint formeel beëindigd of als incident afgesloten;
2. oude pipeline-PR's gesloten of expliciet afgehandeld;
3. sprintnummer, doelbranch, basis-SHA en infra-tag geldig;
4. `config`, sprintdocument en baton vormen één consistente kandidaat;
5. de basiscommit bestaat en is bereikbaar;
6. **alle fouten worden tegelijk en concreet gerapporteerd** (geen faal-op-de-eerste);
7. **alleen bij volledig groen** worden `config`, `sprint.md`, `progress.md` en `handoff.md` **atomair gepubliceerd** en `READY_FOR_DEV` gezet.

De activatie beoordeelt de **kandidaat-sprint én de nog-actieve toestand van de vorige sprint**: een oude **open** PR blokkeert, een correct-gesloten oude PR of een oud, anders-genaamd tag niet (de 1-PR-invariant blijft fail-closed). De command **ondersteunt het nieuwe manifestformaat** (`infra`-namespace-schema) — dat doorbreekt de tweede bootstrap-cirkel (nieuwe config vereist nieuwe guard). Bij een fout blijft Claude eigenaar van de voorbereiding. Alleen wanneer een **externe handeling** nodig is (zoals PR #24 sluiten) gaat de baton met een **concrete actie** naar Bas — niet een generieke melding. **Voorkeur:** dit ís de stop tegen de bootstrap-cirkel — de statemachine wordt machine-afgedwongen i.p.v. adviserend. **Machinegarantie vereist een GitHub-laag (named follow-up, Sprint 15/P0b):** een command voorkomt geen directe omzeiling zolang een agent nog rechtstreeks naar `main` kan pushen. De harde afdwinging vraagt: `main` beschermd tegen directe agent-pushes; alleen een herkenbare **GitSteward-identiteit** (aparte GitHub App, beperkte `Contents: write`) mag de activatie publiceren; andere agent-identiteiten uitsluitend via PR. Sprint 14 levert de command + conventie en bedraadt wat lokaal kan; de GitHub-afdwinging is de expliciete vervolgstap.  **Gevolg van weglaten:** agents blijven zelf `handoff.md` op `main` kunnen zetten en de regels blijven adviserend → dezelfde klasse fouten keert terug.

### 2. Context-afhankelijke coherentie (vervangt de universele gelijkheid)
De coherentiecontrole is **niet** één universele `branch == overal`-check (die deadlockt: bij activatie draait de watcher bewust op `main` terwijl `config` naar een featurebranch wijst). Drie modi:
- **Sprintactivatie:** actuele branch = `main`; manifest bevat de *toekomstige* featurebranch; basis-SHA bestaat.
- **Codex-featurewerk:** actuele branch == de manifestbranch.
- **PR-CI:** de PR-head == de manifestbranch.

`scripts/check_coherence.py` implementeert deze modi en wordt door `activate-sprint` én door Lane A CI gebruikt. **Gevolg van één universele check:** blokkeert opnieuw alles bij de start.

### 3. Concrete guard-/activatiefouten doorgeven
`watch_handoff.py` vangt nu stdout/stderr van de setup-guard maar rapporteert alleen "pipeline setup-lint blokkeerde de sprintstart" → onbruikbaar. **De concrete fout** (bv. "enige open pipeline-PR hoort niet bij de gereserveerde sprintbranch") moet in de `BLOCKED`-`note` en in `autorun.log` terechtkomen. **Gevolg van weggooien:** Claude/Bas moeten achteraf raden — precies wat nu gebeurde.

### 4. Lane A — onbevoorrechte PR-CI-verificatie
`ci.yml` (draait PR-code) verifieert alleen wat `GITHUB_TOKEN` veilig kan lezen: `PIPELINE_AUTOMERGE == off` (via `vars`), oude `pipeline-autoadvance` = `disabled_manually` (via `actions: read`), metadata/config kloppen, PR/branch/SHA komen overeen. **Verwijder de branch-protection-lees hier** (vereist `Administration: read`, bestaat niet in `GITHUB_TOKEN` → 403 → CI rood). Permissions minimaal (`contents/actions/pull-requests: read`); **nooit** een admin-/App-token in deze PR-be­ïnvloede workflow.

### 5. CAS-baton — volledige swap (draait finding-7 terug)
Frontmatter = **volledige CAS**: elke onverwachte frontmatter-afwijking t.o.v. de geobserveerde parent = **verloren race → herlezen + herberekenen** op verse `main`; alleen `progress.md` (append-only) mergen; idempotente "doel-al-bereikt"-tak toetst de **volledige** bedoelde staat + invarianten. Verwijder `test_concurrent_same_state_descriptive_fields_are_preserved_fieldwise`; vervang door een test die bewijst dat een onverwachte divergentie tot re-read/recompute leidt. **Gevolg van veldsgewijs houden:** semantisch tegenstrijdige baton kan doorlopen.

## Scope (in) — `p0a-admin-preflight` verplicht vóór integratie; alleen rebase-SHA mag naar Sprint 15

### 6. `p0a-admin-preflight` — aparte, vertrouwde beheercontrole (VERPLICHT vóór integratie)
Nieuwe workflow die alleen de `main`-workflowversie gebruikt (geen PR-code/checkout/artifacts), puur API, **per run een kortlevend token mint** met `actions/create-github-app-token@v3` en daarmee branch-protection leest met `Administration: read`, fail-closed, `workflow_dispatch` (handmatig Bas).
- Repository variable: `ADMIN_PREFLIGHT_APP_CLIENT_ID`
- Repository secret: `ADMIN_PREFLIGHT_APP_PRIVATE_KEY`
- Tijdelijke stap-output (nooit opgeslagen): `ADMIN_PREFLIGHT_APP_TOKEN`

App: installatie alleen `ALV_Digitaal`, `Administration: read-only`, overige rechten none, webhooks uit. **Gevolg van afwijken (PAT/opgeslagen token):** breder/langlevender geheim. Inert zolang variable/private-key ontbreekt: buiten de PR-gates, handmatige preflight stopt met duidelijke melding, Lane A werkt door, Codex niet geblokkeerd.

### 7. Nood-rebaseplan — eenduidige SHA-rollen (mag naar Sprint 15)
`old_main_base_sha` / `new_main_sha` / `expected_old_branch_head_sha` + merge-base/ancestry-check + `--force-with-lease=<branch>:<expected_old_branch_head_sha>`; dry-run-only tot bewezen.

## Scope (uit — P0b of later)
Native auto-merge activeren · echte Gemini-verdict-check · PII context-aware gate · Environment/deploy-poort · dedup-notifier · lease · labels-migratie · `p0a-admin-preflight` automatisch draaien.

## Acceptatiecriteria (P0a-afronding)

> **P0b-go/no-go is pas geldig als criterium 6 (`p0a-admin-preflight`) groen is.** Zonder admin-preflight is dit control-plane-herstel, geen volledige P0a-afronding.
1. **`activate-sprint` bewezen:** een inconsistente kandidaat (open vreemde PR, niet-bestaande basis-SHA, config/baton-mismatch) faalt met **alle** concrete redenen tegelijk en publiceert niets; een volledig groene kandidaat publiceert config/sprint/progress/handoff **atomair** + `READY_FOR_DEV`. Claude kan `READY_FOR_DEV` niet buiten deze command zetten.
2. **Context-coherentie:** de drie modi (activatie/feature/PR-CI) elk groen op de juiste branch-verwachting; de universele-gelijkheids-deadlock is aantoonbaar weg.
3. **Concrete fout doorgegeven:** een geblokkeerde activatie toont de exacte guard-reden in `note` + `autorun.log`.
4. **Lane A groen zónder admin-lees;** geen `branch/protection`-call in de PR-lane; permissions minimaal.
5. **CAS full-swap bewezen:** onverwachte divergentie → re-read/recompute (nieuwe test groen; oude veld-merge-test weg).
6. **`p0a-admin-preflight` verplicht bewezen vóór integratie:** correct begrensd (alleen `main`-workflow, per-run App-token, `Administration: read`, fail-closed, inert-met-melding zonder credential). Rebase-SHA-rollen + `--force-with-lease` dry-run **mogen** naar Sprint 15.
7. **Alles consistent Sprint 14**; geen verwijzing meer naar `agent/sprint-13-*` of een app-`vX.y.z`-tag voor deze infra-sprint; **geen** actieve native auto-merge; `npm run check` + Python-tests + gates + Gemini groen. Geen deploy; geen productcode naar `main` buiten de PR.

## Overdracht
`handoff.md` → PR bij `READY_FOR_TEST` (Gemini + Lane A-gates) → `READY_FOR_VALIDATION` (Claude tegen ADR-0026 + ADR-0000 + deze criteria) → `READY_FOR_INTEGRATION` (Mistral, **attended exact-SHA-merge**). Vanaf nu wordt élke volgende sprint via `git_steward activate-sprint` geopend. **Deploy nooit.** Bij twijfel/afwijking: `BLOCKED` + `action_required_by: bas` met een **concrete** actie.
