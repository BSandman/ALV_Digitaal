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

## Eigenaarschap van de waarheid

`README.md` (de ingang) en `bijbel.md` (de waarheid) worden **uitsluitend door Claude (Architect)** gewijzigd. Zo is er één schrijver op de gedeelde werkelijkheid en ontstaat geen drift. Elke andere rol — nu Codex/Gemini/Mistral, later bv. DeepSeek — die een wijziging in README of bijbel nodig heeft, meldt dat via de `handoff.md`-`note` (of `state: BLOCKED`); Claude verwerkt het. Elke nieuwe agent leest de README minimaal één keer als nulpunt.

## Onveranderlijke minimumregels

- README.md en bijbel.md: alleen Claude schrijft; anderen stellen voor via handoff.
- Eén eigenaar tegelijk; alleen de eigenaar schrijft `handoff.md`.
- 60 s wachten vóór het claimen van een beurt.
- Productcode uitsluitend via Codex; deploy uitsluitend via Mistral.
- Geen echte PII in O/T/CI (ADR-0004/0005).
- Afwijking van een ADR = nieuwe ADR, niet stilzwijgend.
