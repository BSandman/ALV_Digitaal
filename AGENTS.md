# AGENTS.md — spelregels voor de geautomatiseerde pijplijn

**Beknopt met opzet.** Achtergrond, architectuur en besluiten staan in `bijbel.md`. Wat we nú doen staat in `sprint.md`. Wie aan zet is staat in `handoff.md`. Wat gedaan is staat in `progress.md`. Dit bestand bevat alleen de regels.

## Rollen

- **Claude** — Architect & Validator. Zet architectuur, schrijft acceptatiecriteria/ADR's, valideert tegen ADR-0002. Werkt met Bas vóór de sprint; valideert ná Codex/Gemini.
- **Codex** — Lead Developer. Enige die productcode wijzigt. Bouwt, draait CI, beheert Git (zie onder).
- **Gemini** — Lead Tester. Onafhankelijke functionele/apparaat-/belastingstest.
- **Mistral** — Integrator & AVG-gatekeeper (lokaal). Testdata, PII-scan, merge-integratie, deploy naar A/P.
- **Bas** — eigenaar, finale go/no-go. Wordt **alleen** benaderd bij `BLOCKED` of `action_required_by: bas`.

## Coördinatie = Git + handoff.md

Iedereen werkt in zijn eigen systeem. De enige gedeelde waarheid is de Git-repo. `handoff.md` is de estafettestok: **precies één eigenaar tegelijk**, en alleen die eigenaar schrijft `handoff.md`.

### Statemachine (veld `state` in handoff.md)

```
ARCHITECTUUR ──▶ READY_FOR_DEV ──▶ DEV_IN_PROGRESS ──▶ READY_FOR_TEST
   ▲                                                        │
   │                                                        ▼
SPRINT_DONE ◀── READY_FOR_INTEGRATION ◀── READY_FOR_VALIDATION ◀── TEST_IN_PROGRESS
                    │                          (Claude)              (Gemini)
              INTEGRATION_IN_PROGRESS
```

| state | eigenaar | anderen doen |
|---|---|---|
| `ARCHITECTUUR` | Claude + Bas | niets |
| `READY_FOR_DEV` | Codex | niets |
| `DEV_IN_PROGRESS` | Codex | **niets — niet valideren, niet testen** |
| `READY_FOR_TEST` | Gemini | niets |
| `TEST_IN_PROGRESS` | Gemini | niets |
| `READY_FOR_VALIDATION` | Claude | niets |
| `VALIDATION_IN_PROGRESS` | Claude | niets |
| `READY_FOR_INTEGRATION` | Mistral | niets |
| `INTEGRATION_IN_PROGRESS` | Mistral | niets |
| `BLOCKED` | Bas | wachten |
| `SPRINT_DONE` | Claude + Bas | wachten op nieuwe sprint |

**Harde regel:** een `*_IN_PROGRESS`-state betekent dat alle anderen stil staan. Claude valideert nooit terwijl Codex nog `DEV_IN_PROGRESS` is. Alleen de state, niet aannames, bepaalt wie mag handelen.

**Uitzondering Gemini (ADR-0007):** Gemini draait niet als lokale watcher maar als **GitHub Action op elke Pull Request** (`.github/workflows/gemini-review.yml`). De DEV→TEST-overdracht loopt daarom via een **PR**: Codex opent bij `READY_FOR_TEST` een PR; Gemini's review verschijnt automatisch als PR-comment; de uitvoerende T-tests (k6/regressie) draaien lokaal tegen T. Na groen mergen Codex/Bas en zetten de state op `READY_FOR_VALIDATION`. `watch_handoff.py --role gemini` is dus niet nodig.

### Overdrachtsprotocol (elke agent, elke beurt)

1. `git pull`. Lees de frontmatter van `handoff.md`.
2. Is `owner == ik` en `state == READY_FOR_<mij>`? Zo nee: niets doen, blijf pollen.
3. **Wacht 60 seconden** (race-guard). `git pull` opnieuw; is het nog steeds mijn beurt? Zo nee: afbreken.
4. Zet `state` op `<MIJ>_IN_PROGRESS`, commit + push `handoff.md`. Nu ben ik exclusief eigenaar.
5. Doe het werk (alleen aan bestanden die bij mijn rol horen).
6. Schrijf een regel in `progress.md`. Zet `handoff.md` op de volgende `READY_FOR_<next>` met een korte `note`. Commit + push.
7. Klaar. Terug naar pollen.

Tussen twee handoffs zit dus altijd minimaal 60 seconden. Houd `note` in handoff.md kort (één zin); details in `progress.md`, waarheid in `bijbel.md`. Dit minimaliseert tokens.

### Escalatie naar Bas

Zet `state: BLOCKED` en `action_required_by: bas` met een korte `note` als er (a) een onverwachte fout of afwijking is, (b) een expliciete beslissing/actie van Bas nodig is. Alleen dan wordt Bas geïnformeerd. Anders: doorknallen.

## Git-beheer

**Codex is Git-steward** (dagelijks: branches, merges, tags `vX.y.z`). Reden: Codex raakt als enige productcode en bouwt de releases, dus centraliseren daar voorkomt conflicterende merges. **Mistral** zet de release-/deploytags bij livegang. Gemini en Claude committen alleen hun eigen handoff-/progress-/doc-bestanden.

Regels: werk op feature-branches; `handoff.md` wordt alleen door de huidige eigenaar aangeraakt; geen force-push op `main`; geen twee agents mergen tegelijk. Bij twijfel: `BLOCKED`.

## Watcher

Elke AI draait lokaal een watcher die het protocol hierboven uitvoert. Referentie-implementatie: `scripts/watch_handoff.py` (pollt Git, leest de frontmatter, past de 60s-guard toe, en roept de rol-specifieke "act"-stap aan). Elke agent vult zijn eigen "act" in met zijn eigen runner; de coördinatielogica is identiek. Poll-interval: 30–60 s.

Bij een echte beurt bouwt de watcher een begrensde agentcontext: `handoff.md`, `sprint.md` en `bijbel.md` volledig, plus alleen de laatste 15 regels van `progress.md`. Pas dit zo nodig aan met `--progress-tail N`; de poll-lus bouwt of verstuurt geen context zolang de rol niet aan zet is (ADR-0015).

## Cadans en watchers (operating model)

Twee misverstanden om af te pellen:

- **Watchen kost geen LLM-tokens.** `watch_handoff.py` is een kale Git-poll + bestand-lezen; zolang het niet jouw beurt is, gebeurt er niets duurs. Alleen een **echte beurt** (het `act`-werk) kost tokens. Houd de poller dus gescheiden van het model: de watcher wekt de agent pas als de state zijn `READY_FOR_*` is.
- **Draai niet 24/7.** Werk in **blokken** (bv. 4×30 min per sprint). Aan het begin van een blok start je de watcher(s) van de agent(s) die dán aan zet zijn (zie `handoff.md`); aan het eind stop je ze. Tussen blokken draait er niets → geen tokens, geen window-verbruik.

Regels om te voorkomen dat je op een koud window wacht:

1. **Lijn blokken uit op de beurten.** Een blok heeft idealiter maar één of twee venstergebonden agents nodig. Volgorde per sprint: **dev-blok** (Codex) → op de PR draaien gates + Gemini-review **automatisch** → **validatie-blok** (Claude) → **integratie/deploy-blok** (Mistral).
2. **Gemini is serverless.** Zijn review draait als GitHub Action op de PR — geen usage-window, dus Gemini is nooit de bottleneck en hoeft niet "wakker" te zijn.
3. **Window uitgeput bij jouw beurt?** Geen live keten die vastloopt: de baton blijft gewoon op jouw `READY_FOR_*` staan, het blok pauzeert, en je pakt 'm op zodra je window weer open is. Zet alleen een `note` als er iets bijzonders is.
4. **Alleen de venstergebonden hop telt.** Omdat blokken kort en gescheiden zijn, blokkeert een uitgeput window van één agent alleen zijn eigen blok — niet een doorlopende keten.

Activeren = per agent-omgeving `python scripts/watch_handoff.py --role <rol>` starten aan het begin van diens blok (Gemini niet — die is de Action). Begin semi-handmatig/gescheduled; zet continue watchers pas aan als een paar volledige cycli bewezen zijn.

### Begeleide autorun

1. Kopieer `mistral-lokaal/autorun.config.example.ps1` lokaal naar `mistral-lokaal/secure/autorun.config.ps1` en laad de instellingen met `. .\mistral-lokaal\secure\autorun.config.ps1`. Pas alleen een lokaal pad aan als het programma niet via `PATH` vindbaar is. Geheimen en lokale paden blijven zo buiten Git. Gemini krijgt nooit een lokale runner.
2. Controleer en test ieder runnercommando eerst **los** in dezelfde PowerShell-sessie:
   - Codex: `Get-Command codex`; daarna `'Lees stdin, wijzig niets en antwoord alleen RUNNER_OK.' | codex exec --sandbox workspace-write --ask-for-approval never --ephemeral --config sandbox_workspace_write.network_access=true -`.
   - Claude: `Get-Command claude`; daarna `'Lees stdin, wijzig niets en antwoord alleen RUNNER_OK.' | claude --print --input-format text --output-format text --permission-mode dontAsk --tools Read --allowedTools Read --max-turns 1 --no-session-persistence`.
   - Mistral: `node mistral-lokaal/scripts/run_integration_turn.mjs --help`. Start de echte integratiebeurt alleen via de watcher; de runner claimt en commit de baton.
3. Start daarna **attended-first**, met Bas achter het scherm en maximaal één beurt: `python scripts/watch_handoff.py --role <rol> --autorun --max-turns 1`. CLI-opties overschrijven de lokale defaults. De eerste echte beurt per rol moet eindigen met een schone working tree en `HEAD...@{u}` = `0 0`.
4. Pauzeer alle watchers direct met `New-Item autorun.paused -ItemType File -Force`; dit breekt ook een actieve runner-procesboom af. Hervat pas bewust met `Remove-Item -LiteralPath .\autorun.paused`. `Ctrl+C` stopt de huidige watcher en zijn runner-procesboom.
5. Kijk mee via `scripts/status.ps1` of `status.html`. Bij een runner-/statefout zet de watcher de baton op `BLOCKED`, meldt Bas en stopt zonder retry. Autorun mag nooit deployen; `action_required_by: bas` blijft een menselijke poort.

Onbemand of overnight draaien blijft uit totdat meerdere begeleide cycli inclusief kill-switch en notifier aantoonbaar groen zijn en Bas dit afzonderlijk activeert.

## Meekijken

- `powershell -ExecutionPolicy Bypass -File scripts/status.ps1` toont lokaal de baton, autorun/pauze, loop-teller, recente activiteit, Git-status en open PR-checks. Herhaal het commando in een korte `while`-lus voor live terminalzicht.
- `powershell -ExecutionPolicy Bypass -File scripts/status.ps1 -Html -Watch` schrijft en ververst het lokale, git-genegeerde `status.html`; open dit in de browser voor hetzelfde overzicht. `Ctrl+C` stopt alleen het verversen.
- Elke autorun-beurt en notifieractie schrijft één veilige chronologische regel naar het lokale, git-genegeerde `autorun.log`. Runneruitvoer en secrets komen daar niet in.
- GitHub blijft de duurzame bron voor Actions, PR's, commits en `handoff.md`; de notifier meldt uitsluitend uitzonderingen. Een `autorun.paused`-bestand in de reporoot pauzeert alle lokale watchers direct.

## Eigenaarschap van de waarheid

`README.md` (de ingang) en `bijbel.md` (de waarheid) worden **uitsluitend door Claude (Architect)** gewijzigd. Zo is er één schrijver op de gedeelde werkelijkheid en ontstaat geen drift. Elke andere rol — nu Codex/Gemini/Mistral, later bv. DeepSeek — die een wijziging in README of bijbel nodig heeft, meldt dat via de `handoff.md`-`note` (of `state: BLOCKED`); Claude verwerkt het. Elke nieuwe agent leest de README minimaal één keer als nulpunt.

## Onveranderlijke minimumregels

- README.md en bijbel.md: alleen Claude schrijft; anderen stellen voor via handoff.
- Eén eigenaar tegelijk; alleen de eigenaar schrijft `handoff.md`.
- 60 s wachten vóór het claimen van een beurt.
- Productcode uitsluitend via Codex; deploy uitsluitend via Mistral.
- Geen echte PII in O/T/CI (ADR-0004/0005).
- Afwijking van een ADR = nieuwe ADR, niet stilzwijgend.
