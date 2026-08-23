# Codex-taak — Sprint 13: CI/CD-hardening P0a (liveness/correctheid)

**Ontwerp:** ADR-0026 + `Platform/_design-prestage/cicd/CICD-herontwerp-DEFINITIEF.md` (P0a). **Zelf-modificerend, attended.** Eerste, plan-agnostische fase: de pijplijn *correct en observeerbaar* maken. **Native auto-merge gaat NIET aan in deze sprint.**

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

## Overdracht
`handoff.md` -> PR bij `READY_FOR_TEST` (Gemini + gates), daarna `READY_FOR_VALIDATION` (Claude tegen ADR-0026 + deze criteria), dan `READY_FOR_INTEGRATION` (Mistral, **attended exact-SHA-merge**). **Deploy nooit.** Bij twijfel/afwijking van een ADR: `BLOCKED` + `action_required_by: bas`.
