# Codex-taak — Git-hardening: GitSteward als apart deterministisch proces (ADR-0025)

Doel: het leeuwendeel van de autorun-uitval (git) wegnemen door één deterministische **GitSteward** die álle schrijfacties naar `main` en álle pushes bezit, met verplichte block-finalize en retry. LLM-runners worden git-light en kunnen offline. Ontwerp: **ADR-0025**. Harness: `scripts/watch_handoff.py`.

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
