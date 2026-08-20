# Codex-taak — Git-hardening: GitSteward als apart deterministisch proces (ADR-0025)

Doel: het leeuwendeel van de autorun-uitval (git) wegnemen door één deterministische **GitSteward** die álle schrijfacties naar `main` en álle pushes bezit, met verplichte block-finalize en retry. LLM-runners worden git-light en kunnen offline. Ontwerp: **ADR-0025**. Harness: `scripts/watch_handoff.py`.

## Fix-ronde 1 (na CI-review — DIT NU) — blijf op branch `agent/sprint-11-gitsteward-core`

De Stap 1-kern (`git_steward.py`) is inhoudelijk goed en door Claude gevalideerd tegen ADR-0025. Twee CI-bevindingen op PR #20 blokkeren de merge; los ze op **dezelfde branch** op en herpush (werkt de PR bij), zet daarna de baton terug naar `READY_FOR_TEST`.

1. **PII-gate false-positive (Gate B + Gemini-voorwacht, ADR-0005).** `mistral-lokaal/scripts/pii_scan` flagt legitieme placeholder-adressen: `git-steward@localhost.invalid` (commit-identiteit in `git_steward.py`) en `@example.invalid` in `tests/test_git_steward.py`. **Fix:** whitelist in de e-maildetector de RFC-2606/6761 gereserveerde, niet-routeerbare domeinen — een adres waarvan het domein eindigt op `.invalid`, `.test`, `.example`, `.localhost`, of gelijk is aan `example.com`/`.org`/`.net`, is géén bevinding. Houd de gate streng voor echte domeinen. Borg met een test in de pii-scan-suite: `x@y.invalid` schoon, `iemand@gmail.com` nog steeds rood. (Wijzig de placeholders zelf niet — elk e-mailadres triggert anders opnieuw.)

2. **Echte testfout — rebase-recovery verliest de coördinatie-commit.** `test_non_fast_forward_push_recovers_with_rebase_retry` faalt: na een concurrent competing push zijn `push_attempts==2` en `product.txt==release-v2`, maar de remote `progress.md` mist de `coordination`-inhoud (`'coordination' not found in '# Progress\n'`). De coördinatie-commit overleeft de rebase-recovery dus niet. Dit is de resilience-tak en moet echt kloppen. **Onderzoek** het `sync()`-push-retrypad met `recovery=_pull_once`: na de non-ff push moet de coördinatie-commit aantoonbaar op de opgehaalde competing-head worden herspeeld en in `HEAD` zitten vóór de her-push (bv. fetch + `rebase origin/main` + verifieer aanwezigheid, of her-stage/commit als de rebase 'm dropt). Maak de test groen: coördinatie op remote, `product.txt==release-v2` behouden, beide commits in de log.

**DoD fix-ronde:** 102/102 Python-tests groen, PII-gate groen (placeholders schoon, echte adressen nog rood), overige gates + Gemini groen; geen productcode naar main; baton → `READY_FOR_TEST`.

## Fix-ronde 2 (na CI-review 2) — committer-identiteit ontbreekt bij `git rebase`

Fix-ronde 1 is groen behalve `test_non_fast_forward_push_recovers_with_rebase_retry`, die **alleen in een schone omgeving (CI) faalt** — lokaal reproduceerbaar met `HOME=<leeg> GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null`. **Geverifieerde root cause:** de steward geeft zijn git-subprocessen geen committer-identiteit. `_commit` zet die inline (`-c user.name/user.email`), maar `_recover_coordination_push` roept `git rebase origin/main` aan **zonder** identiteit. In CI (geen ambient git-config) kan de rebase de coördinatie-commit niet herspelen; de fout wordt in de retry-recovery ingeslikt, HEAD blijft op de competing-basis (zónder coördinatie), en push-poging 2 pusht die → remote krijgt product-v2 maar geen coördinatie. Alleen deze test triggert een echte rebase, vandaar dat de rest groen was.

**Fix (precies, geverifieerd):**
1. **Identiteit voor álle git-ops.** Zet in `_environment()` (die naar elke `_run_git` gaat) `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` / `GIT_COMMITTER_NAME` / `GIT_COMMITTER_EMAIL` op de bestaande steward-identiteit (`ALV GitSteward` / `git-steward@localhost.invalid`). Zo hebben rebase, cherry-pick, merge én commit altijd een identiteit, onafhankelijk van ambient config. (`_commit`'s inline `-c` mag blijven of vervallen — env dekt het.)
2. **Defense-in-depth (fail-closed).** Laat `_recover_coordination_push` ná de rebase **verifiëren** dat de coördinatie-inhoud in `HEAD` zit vóór de her-push (bv. de coördinatie-commit aanwezig / `git show HEAD:progress.md` bevat de snapshot); zo niet → `GitStewardError` i.p.v. een "succesvolle" push zonder coördinatie. Dan kan een stille rebase-fout nooit meer als groen doorgaan.

**Verificatie-eis:** de suite draait groen in een **schone git-omgeving** — voeg dit toe aan de test/CI-redenering (`GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null` + lege `HOME`), zodat env-afhankelijkheid niet terugkeert. 102/102 groen, alle gates + Gemini groen, baton → `READY_FOR_TEST`.

---

_De rest van dit document is de oorspronkelijke Stap 1–3-scope._

## Fasering — LEVER EERST STAP 1 (deze beurt)

De taak is te groot voor één beurt. Splits in drie beurten; **rond deze beurt uitsluitend Stap 1 volledig af** (PR openen + baton → `READY_FOR_TEST`). Stap 2 en 3 zijn aparte latere beurten.

- **Stap 1 (nu):** `scripts/git_steward.py` — het deterministische kernscript met `sync` + `block_finalize` + retry/backoff + stale-`index.lock`-opruiming + `GH_TOKEN`-gebruik, mét Python-tests (fixtures). **Nog geen** `watch_handoff.py`-refactor. Draai de bestaande gates, open een PR op `agent/sprint-11-gitsteward-core`, zet de baton door.
- **Stap 2 (volgende beurt):** `watch_handoff.py` roept de steward aan voor sync + verplichte block-finalize; rol-runners pushen niet meer.
- **Stap 3 (daarna):** runners git-light/offline-baar maken + runbook; de GitSteward draait als eigen niet-gesandboxd proces (buiten de Codex-sandbox — vandaar geen `.git`-DENY).

De rest van dit document is de volledige eindscope (Stap 1–3 samen) als referentie.

## Scope (in)

1. **GitSteward-proces (deterministisch, geen LLM):** nieuw script (`scripts/git_steward.py`, dependency-vrij, stijl van `advance_after_merge.py`). Enige houder van `GH_TOKEN` (uit `secure/`, via `gh auth git-credential` of `git -c http.extraheader`). Functies:
   - `sync`: `pull --rebase` van `main`, coordination-commit (`handoff.md` + `progress.md`), `push` — met **retry + exponentiële backoff** (3×) en **stale-`index.lock`-opruiming** (verwijder alleen als ouder dan N s en geen levend git-proces).
   - `block_finalize(role, note)`: zet/behoud `BLOCKED`-baton (owner bas, `action_required_by: bas`) + schrijf de `progress.md`-regel, **commit + push naar `main`**. Idempotent; faalt gesloten.
   - Alleen `handoff.md`/`progress.md` gaan automatisch naar `main`; **nooit productcode** (staged productcode blijft op de werkbranch/PR).
2. **`watch_handoff.py` refactoren:** rol-runners doen geen eigen push meer. Na een beurt (of bij een fout/blokkade) roept de watcher de GitSteward aan voor sync resp. block-finalize. De runner-omgeving heeft **geen credentials/netwerk** meer nodig voor de git-stap.
3. **Runners offline-baar maken:** documenteer + ondersteun dat de Codex-/Claude-runner-ARGV zonder netwerk/credential draait (de LLM commit lokaal op zijn werkbranch; de steward pusht). Interim (tot dit af is) blijft de Codex-runner `--sandbox danger-full-access` + `GH_TOKEN`; erna kan de sandbox weer dicht.
4. **Retry/lock/backoff centraal:** transient git (lock, netwerk-hik, non-fast-forward → rebase-retry) lost in de steward op zónder blokkade. Alleen een fout die ná retries blijft → `block_finalize` + escalatie.

## Scope (uit)

Feature-branch-commits + PR-creatie volledig naar de steward trekken (blijft runner-output) · de PR-gate/auto-advance-mergeroute wijzigen · deploy · nieuwe productfunctionaliteit · Gemini lokaal.

## Architectuurregels / veiligheid

- **Alleen coördinatiebestanden auto naar `main`**; half-af productcode nooit auto-merged (ADR-0025 §5). De bestaande PR-gate blijft de enige merge-route naar `main`.
- `GH_TOKEN` uitsluitend in `secure/` (gitignored), nooit in tracked config/logs; steward redigeert tokens uit alle output.
- Deploy blijft menselijke poort (ADR-0013/0017). Geen echte PII in O/T/CI (ADR-0004/0005).
- `handoff.md` blijft ≤ 20 regels (lint_handoff.py); block-finalize schrijft een korte `note`.

## Acceptatiecriteria / tests

1. **Block-finalize gegarandeerd:** een runner die blokkeert vóór commit → de steward commit+pusht de `BLOCKED`-baton + `progress.md`-regel naar `main`; `git status --porcelain` daarna **leeg**, `HEAD...@{u}` = `0 0`. (Dekt precies de dangling-`progress.md`-klasse.)
2. **Transient-git-herstel:** een gesimuleerde stale `index.lock` en een non-fast-forward-push worden door retry/rebase opgelost **zonder** blokkade; bewijs met fixture.
3. **Echt-kapot escaleert:** een blijvende git/credential-fout (na retries) → `BLOCKED` + `action_required_by: bas`, geen productcode geraakt.
4. **Credential-isolatie:** een rol-runner zonder `GH_TOKEN`/netwerk kan zijn beurt lokaal doen; alleen de steward pusht. Test dat de runner-stap geen credential vereist.
5. **Geen productcode naar main:** met staged productcode + een coördinatiewijziging pusht de steward alléén `handoff`/`progress` naar `main`; de productcode blijft op de werkbranch.
6. **Idempotent + fail-closed:** dubbele `block_finalize`/`sync` geeft geen dubbele commits of corrupte state; een beschadigde state stopt veilig.
7. **`npm run check` + Python-tests + architectuur-, release-, handoff- en PII-gates + Gemini-review groen.** Geen deploy.

## Overdracht

`handoff.md` → open PR bij `READY_FOR_TEST` (Gemini + gates), daarna `READY_FOR_VALIDATION` (Claude tegen ADR-0025), dan `READY_FOR_INTEGRATION` (Mistral). Bij een nodige beslissing/afwijking: `BLOCKED` + `action_required_by: bas`. **Deploy nooit.**
