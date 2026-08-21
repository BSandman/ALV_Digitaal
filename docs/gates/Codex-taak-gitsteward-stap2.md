# Codex-taak — Sprint 12 (Git-hardening Stap 2): watcher ↔ GitSteward + context/protocol-verfijningen (ADR-0025)

**Voorwaarde:** Stap 1 (PR #20, `git_steward.py`) staat **gemerged op `main`** (Sprint 11/SPRINT_DONE). Deze taak bouwt daarop. Ontwerp: **ADR-0025**. Harness: `scripts/watch_handoff.py`. **Attended, zelf-modificerend** (zie onderaan).

Doel: de `watch_handoff.py`-watcher zijn eigen git-schrijfacties laten **delegeren aan de GitSteward**, zodat de verplichte block-finalize en de gehele coördinatie-push via de geteste, deterministische steward lopen. Tegelijk drie samenhangende verfijningen aan dezelfde watcher/context-laag. **Credential-isolatie (runners volledig offline) is Stap 3, niet nu** — de rol-runners blijven voorlopig hun eigen feature-branch pushen.

## Scope (in)

1. **Watcher delegeert coördinatie-git aan de steward.** Vervang in `watch_handoff.py` de eigen inline coördinatie-commit/push van `handoff.md`/`progress.md` naar `main` door een aanroep van `git_steward.sync()`. Vervang het bestaande BLOCKED-pad (dat nu inline commit/pusht + notifier draait) door `git_steward.block_finalize(role, note)` gevolgd door de notifier. De steward is de enige die naar `main` schrijft; de watcher roept 'm aan (subprocess `python scripts/git_steward.py …` of directe import — kies één, deterministisch, met tokenlek-redactie).
2. **Verplichte block-finalize overal.** Elke fout-/blokkade-uitgang van de watcher loopt via `block_finalize` → BLOCKED-baton + progressregel gecommit+gepusht → schone tree, `main` reflecteert de blokkade. Alleen een fout die de steward zelf ná retries niet kan wegschrijven, escaleert lokaal (geen dangling tree).
3. **Bijbel-context per rol trimmen** (raakt de context-builder in `watch_handoff.py`, ADR-0015). Volledige `bijbel.md` alleen voor **Claude** (validator). Voor **Codex/Mistral**: `handoff.md` + `sprint.md` + het ADR-**register** (§9) + `rollen` (§2) + `versiebeheer` (§8) + het rol-taakdoc + de bestaande `progress`-staart — **niet** de volledige bijbel. Maak het knopbaar (bv. `--bijbel full|register`, default per rol). Agents lezen een specifieke ADR op afroep (ze hebben filesystem-toegang).
4. **`docs/gates/Codex-instructie.md` aanpassen.** "Lees eerst: `bijbel.md`" → "Lees eerst `sprint.md` + je taakdoc; raadpleeg het ADR-register (§9) en lees een specifieke ADR alléén als je taak die raakt." (Dit is instructie-/gate-doc; Claude heeft dit al akkoord — voer het door.)
5. **Dubbele race-guard weghalen.** De 60s-race-guard is exclusief van de watcher (protocolstap 3). Haal de tweede, redundante "wacht 60 seconden"-stap uit het runner-overdrachtsprotocol/de runner-prompt, zodat de runner 'm niet nog eens uitvoert. De watcher-guard blijft ongewijzigd.
6. **Schoon afsluiten na `--max-turns`.** Na het bereiken van de beurtenlimiet (bv. `--max-turns 1`) moet de watcher **cleanly exit** (proces stopt, `running`-state op false) i.p.v. te blijven pollen/idlen met `running: true`. Dat blijven-hangen leest nu ten onrechte als een vastloper. `autorun-status.json` weerspiegelt de gestopte staat.

## Scope (uit — Stap 3 of later)

Feature-branch-push + PR-creatie naar de steward verplaatsen (→ runners volledig offline/credential-loos: **Stap 3**) · de PR-gate/auto-advance-mergeroute wijzigen · deploy · productfunctionaliteit · Gemini lokaal.

## Architectuurregels / veiligheid

- Alleen coördinatie (`handoff`/`progress`) gaat via de steward naar `main`; **nooit** productcode naar `main` (blijft branch/PR). De bestaande PR-gate blijft de enige merge-route.
- `GH_TOKEN` uitsluitend bij de steward (`secure/`); geen token in logs — redactie behouden.
- Deploy blijft menselijke poort (ADR-0013/0017). `handoff.md` ≤ 20 regels. Geen echte PII in O/T/CI (ADR-0004/0005).
- De bijbel-trim is een **bewuste, geteste** wijziging aan de vangrail — niet stilzwijgend wegtrimmen; Claude valideert dat de gezaghebbende regels bereikbaar blijven.

## Acceptatiecriteria / tests

1. **Block-finalize via steward:** een gesimuleerde blokkade in de watcher → `git_steward.block_finalize` schrijft+pusht de BLOCKED-baton + progressregel; daarna `git status --porcelain` leeg en in-sync. Bestaande dangling-tree-klasse aantoonbaar weg.
2. **Coördinatie-sync via steward:** een normale coördinatie-overgang loopt via `git_steward.sync()`; de watcher doet zelf geen `git commit/push` meer op `handoff`/`progress`.
3. **Context per rol:** voor rol `codex`/`mistral` bevat de opgebouwde context **niet** de volledige bijbel maar wél register+rollen+versiebeheer+taakdoc; voor `claude` wél de volledige bijbel. Test/asserteer de samenstelling.
4. **Geen dubbele race-guard:** test bewijst dat de runner-beurt de 60s-wachtstap niet opnieuw uitvoert; de watcher-guard blijft aantoonbaar intact.
5. **`Codex-instructie.md`** verwijst niet meer naar "lees eerst de volledige bijbel"; contract/gate-check hierop indien aanwezig.
5b. **Schoon exit:** een `--max-turns 1`-run eindigt met een gestopt proces en `running: false` in `autorun-status.json` (geen na-idlen); test/asserteer dit.
6. **`test_watch_handoff.py`** bijgewerkt en groen; geen regressie in de bestaande watcher-tests.
7. **`npm run check` + Python-tests + architectuur-, release-, handoff- en PII-gates + Gemini-review groen.** Geen deploy. Geen productcode naar `main`.

## Zelf-modificerend — verplichte werkwijze

Deze taak wijzigt de watcher die de beurten zélf draait. Daarom:
- **Attended**, `--max-turns 1`, Bas kijkt mee. Niet onbemand aanzetten.
- Na de wijziging: bewijs met **één volledige begeleide beurt op de nieuwe watcher** dat een echte overgang (incl. steward-sync én een gesimuleerde block-finalize) schoon en in-sync eindigt, vóórdat de nieuwe watcher als standaard wordt vertrouwd. Bij twijfel: `BLOCKED` + `action_required_by: bas`.

## Overdracht

`handoff.md` → PR bij `READY_FOR_TEST` (Gemini + gates), daarna `READY_FOR_VALIDATION` (Claude tegen ADR-0025 + ADR-0015), dan `READY_FOR_INTEGRATION` (Mistral). **Deploy nooit.**
