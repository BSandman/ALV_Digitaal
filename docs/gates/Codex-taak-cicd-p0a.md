# Codex-taak — Sprint 13: CI/CD-hardening P0a (liveness/correctheid)

**Ontwerp:** ADR-0026 + `Platform/_design-prestage/cicd/CICD-herontwerp-DEFINITIEF.md` (P0a). **Zelf-modificerend, attended.** Eerste, plan-agnostische fase: de pijplijn *correct en observeerbaar* maken. **Native auto-merge gaat NIET aan in deze sprint.**

**Raakt:** ADR-0026 · ADR-0023 (PR-gate) · ADR-0015 (guardrails) · ADR-0025 (GitSteward) · `scripts/pipeline_guard.py` · `scripts/watch_handoff.py` · `scripts/git_steward.py` · `config/pipeline-sprint.json` · `.github/workflows/pipeline-autoadvance.yml`. Loop deze keten af vóór je iets wijzigt: een aanpassing hier raakt de baton-transitie op `main` én de merge-poort — afwijken van één stuk breekt de rest.

## Werkwijze (lessen uit Sprint 10 — belangrijk)
- Branch: **`agent/sprint-13-cicd-p0a`** (NIET `feat/` — de auto-advance vereist `agent/*` of het `pipeline`-label).
- Draai de watchers op **`main`**, niet op de feature-branch (de baton leeft op `main`).
- Attended, `--max-turns 1`; **merge attended en exact op SHA** (geen native auto-merge; `PIPELINE_AUTOMERGE` blijft `off`).
- Een begeleide beurt moet schoon + in-sync eindigen voor de nieuwe steward/watcher wordt vertrouwd.

## Scope (in)

1. **Een betrouwbare `main`-observatie.** De watcher/steward leest de coordinatiestaat uit een **aparte, schone `main`-worktree/observatie**, gescheiden van de runner-feature-worktree — nooit dezelfde working tree voor observatie en runner-branch. Coordinatie (`handoff`/`progress`) gaat uitsluitend via de GitSteward naar `main`, **nooit op de PR-head**.
2. **GitSteward: echte compare-and-swap + idempotente transitie.** Commit een coordinatietransitie **uitsluitend op de geobserveerde parent** en push **non-force** (`git push origin HEAD:main`); non-fast-forward = verloren race -> **herlezen + opnieuw beslissen op verse `main`**, geen rebase-van-oude-snapshot-over-nieuwere-staat. Transitiefunctie **idempotent t.o.v. de doelstaat** (al bereikt -> no-op met reden, geen fout). Vervang het huidige rebase-en-heraanbrengen-pad.
3. **Exacte PR-nummer/SHA-verificatie.** Primaire identiteit = het PR-nummer uit een vertrouwd event; lees die PR direct en verifieer `baseRefName`/repo/branch/`headRefOid`. Branchnaam-zoek is secundair. **Nul** op branchnaam is pas een idempotente no-op **nadat via PR-nummer bewezen is** dat de PR `MERGED`/`CLOSED` is en de vervolgactie al is gedaan; **nul bij een verwachte open PR = harde fout**; **>1 = fail-luid**.
4. **1-sprint-1-PR-invariant (setup-lint).** Voor sprintstart controleert de setup-lint/dispatcher dat er **max. een** open PR met `agent/*`/`pipeline`-label naar `main` bestaat; een tweede kandidaat -> `BLOCKED` (geen willekeurige selectie). Reserveer versienummer + release-tag in de sprintmetadata; een bestaande tag met afwijkende SHA -> harde incident-route.
5. **Noodpad voor een bewegende `main`.** Leg vast en implementeer: *"require branches up-to-date"* staat uit zolang coordinatie op `main` landt (required checks blijven aan de actuele PR-head-SHA); geen productwijziging op `main` buiten de actieve sprint-PR; een noodhotfix activeert **eerst** de repo-brede pauze, daarna een **gecontroleerde rebase** van de sprintbranch (nieuwe head-SHA -> alle checks opnieuw). Branchregel: **geen merge-commit `main`->sprintbranch**; gecontroleerde rebase alleen in de noodprocedure.
6. **Merge-enabler op dry-run/off.** Bouw de exacte-SHA-merge-enabler maar laat 'm op `PIPELINE_AUTOMERGE=off`/dry-run; de daadwerkelijke merge in deze sprint gebeurt **attended, exact op SHA** via het bestaande fail-closed pad. `pipeline-autoadvance.yml` blijft ongewijzigd tot P0b (dan de enige merge-eigenaar).

## Scope (uit — P0b of later)
Privileged/unprivileged workflow-split · echte Gemini-verdict-check · PII context-aware gate · native auto-merge activeren · Environment/deploy-poort · dedup-notifier · lease · labels-migratie · validatie-voor-merge · release/deploy-tags.

## Acceptatiecriteria / go-no-go -> P0b
1. **CAS-testset groen:** concurrerende coordinatieschrijver, stale source-state, doelstaat-al-bereikt (idempotent), ongeldige sprong (geweigerd), gelijktijdige `progress.md`-wijziging. Aantoonbaar dat een oudere snapshot **niet** over een nieuwere staat wordt geschreven.
2. **PR/SHA-resolve bewezen:** 1 open PR -> correct; 0 -> bewezen-MERGED/CLOSED-no-op met reden-log, en harde fout bij een verwachte-maar-afwezige open PR; >1 -> fail-luid.
3. **1-PR-invariant:** een tweede open `agent/*`-PR naar `main` levert aantoonbaar `BLOCKED`, geen willekeurige keuze.
4. **Noodpad-rebase** in droogloop bewezen: pauze -> gecontroleerde rebase -> nieuwe head-SHA -> checks opnieuw; geen merge-commit `main`->branch.
5. **Geen actieve native auto-merge**; merge-enabler aantoonbaar off/dry-run.
6. **`npm run check` + Python-tests + architectuur-, release-, handoff- en PII-gates + Gemini-review groen.** Geen deploy; geen productcode naar `main` buiten de PR.

## Fix-ronde 1 (recovery) — findings uit de 2-subagent review

PR #23 mergde vroegtijdig (de oude auto-advance stond nog live op `PIPELINE_AUTOMERGE=on`) en de guard was fail-open, dus P0a landde onbedoeld in twee PR's. De auto-advance-workflow is nu **disabled** en `PIPELINE_AUTOMERGE=off`. Deze fix-ronde voltooit P0a. Werk op **`agent/sprint-13-cicd-p0a-fix1`**, attended, watchers op `main`, merge attended exact-op-SHA.

**Fail-closed (blockers):**
1. `scripts/pipeline_guard.py::_repository_variable`: een niet-nul `gh`-exit / onleesbare variabele -> **raise/BLOCK**, niet `None`-als-off. `setup` passeert alleen bij *leesbaar-en-exact-`off`*; onleesbaar/403/non-`off`/synoniem -> `BLOCKED`.
2. `scripts/watch_handoff.py::run_pipeline_setup_guard`: ontbrekende `config/pipeline-sprint.json` bij een sprint-start-beurt = **hard block**, geen silent `return`.
3. **Tag-namespace:** ontkoppel `version`/`release_tag` in `config/pipeline-sprint.json` van de app-versie; pipeline/infra-sprints krijgen een eigen namespace (bv. `infra-p0a`) of geen app-`vX.y.z`-tag, zodat `verify_reserved_tag` niet botst met de app-`0.2.0`.
4. **Live-bron boven file-assertie:** de guard verifieert de **live** repo-status (variabele/branch-protection); een bestand (`native_automerge`/`require_branches_up_to_date`) mag de live-controle nooit vervangen, of documenteer expliciet dat het bestand niet-gezaghebbend is.

**4-bis. Waar de auto-merge-status wordt geverifieerd (belangrijk — gecorrigeerd).** `_repository_variable` draait nu **lokaal** (via de watcher) met het ambient `GH_TOKEN`; dat fijnmazige PAT mist de **Repository -> Variables (read)**-permissie -> de 403. **Voorkeursfix:** verplaats de auto-merge-off-verificatie **naar CI** — in een GitHub Action zijn `vars.PIPELINE_AUTOMERGE` én de workflow-enabled-status native leesbaar zónder extra PAT-scope (consistent met "live-bron boven file-assertie"). Houd je 'm tóch lokaal, dan (a) fail-closed én (b) geef het lokale PAT `Variables: Read-only` — op het token zelf (Developer settings -> fine-grained PAT), niet in repo -> Actions -> Variables. De echte P0a-garantie blijft dubbel: de auto-advance-workflow is **disabled** + `PIPELINE_AUTOMERGE=off`; de guard is defense-in-depth, geen enige-poort.

**Rode tests (harde eis voor de P0b-poort):**
5. Toevoegen: 403/onleesbare `PIPELINE_AUTOMERGE` -> `BLOCKED`; ontbrekende metadata -> `BLOCKED`; `setup`-automerge-block end-to-end; `resolve` bij MERGED-zonder-follow-up -> harde fout.

**Robuustheid (majors/minors):**
6. `scripts/git_steward.py` (post-push housekeeping): een fout in de lokale opruiming na een geslaagde non-force push -> **waarschuwing**, geen valse `BLOCKED`.
7. `git_steward.py` handoff-transitie op verse `main`: **veldsgewijs** (niet wholesale overschrijven), zodat `note`/`since`/`next` van een concurrent-writer-in-dezelfde-state niet worden geklobberd.
8. `ALV_NOTIFIER_STATE`: maak de lezing fail-safe als 'ie ontbreekt (de lokale autorun-config zet 'm voortaan, buiten de repo).

**Buiten deze fix-ronde (run-config, apart) — keuze met voorkeur:** `--sandbox danger-full-access` -> `workspace-write`. **Voorkeur:** `workspace-write` (de GitSteward-scheiding maakt dit mogelijk; minste blast-radius). **Gevolg van afwijken (op `danger-full-access` blijven):** de runner kan buiten de worktree schrijven en netwerken -> je verliest de isolatiegarantie die ADR-0025 juist levert; kies dat alleen bewust en documenteer waarom. Niet forceren binnen deze sprint.

**Merge-veiligheid (P0a):** de nieuwe exacte-SHA-enabler blijft dry-run/off; het oude merge-pad blijft tot P0b, maar de auto-advance-workflow is disabled + `PIPELINE_AUTOMERGE=off`. Documenteer dat P0a-merge-veiligheid een-guard-diep is (vandaar #1 als blocker).

**Acceptatie:** de bestaande P0a-criteria + deze fix-ronde; de **P0b-go-poort eist een groene rode-test op het 403/onleesbaar-pad**. `npm run check` + Python-tests + gates + Gemini groen. Geen deploy; merge attended exact-op-SHA.

## Overdracht
`handoff.md` -> PR bij `READY_FOR_TEST` (Gemini + gates), daarna `READY_FOR_VALIDATION` (Claude tegen ADR-0026 + deze criteria), dan `READY_FOR_INTEGRATION` (Mistral, **attended exact-SHA-merge**). **Deploy nooit.** Bij twijfel/afwijking van een ADR: `BLOCKED` + `action_required_by: bas`.
