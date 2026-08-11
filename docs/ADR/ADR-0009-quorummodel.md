# ADR-0009 — Quorummodel: vergadering-breed, eenmalig, presentie-gebaseerd

**Status:** geaccepteerd
**Datum:** 11 augustus 2026
**Beslisser:** Bas (domein/juridisch); vastgelegd door Claude (Architect & Validator)
**Context-links:** [[ADR-0002]] (atomair sluiten), [[ADR-0006]] (stemprocedure, voorzitter stelt vast), [[ADR-0008]] (exacte rekenkunde), validatie `docs/gates/Claude-validatie-sprint2.md`

## Context

Bij de validatie van PR #2 bleek dat `app/src/domain/vote-result.js` het **quorum per stemronde herberekent** uit de uitgebrachte stemmen (`present` = som van de gewichten van voor/tegen/blanco/onthouding). Dat is structureel onjuist. Bas heeft de werkelijke regel bevestigd.

## Besluit

1. **Quorum is een vergadering-brede vaststelling, éénmalig.** De **voorzitter** stelt vóór de eerste stemronde vast of er quorum is. Daarna wordt binnen een ronde geen quorum meer bepaald.
2. **Grondslag = presentie, niet uitgebrachte stemmen.** Het quorum is de optelsom van het stemgewicht van de **aanwezige** rechten plus het stemgewicht van de **ingeleverde machtigingen/stemformulieren** (nu nog fysiek/papier). Iemand die aanwezig is maar (nog) niet stemt, telt dus mee.
3. **Bevroren vlag.** Is de quorumvlag eenmaal gezet, dan ligt die vast voor de hele vergadering; geen enkele ronde herberekent of wijzigt hem.
4. **Per ronde alleen de meerderheid.** De ronde-uitslag berekent uitsluitend de meerderheid (`voor` versus beslissend `voor+tegen`, exact per ADR-0008 §3). De ronde **verwijst** naar de vergadering-brede quorumvlag (rapporteert 'm), maar berekent geen quorum.
5. **Gekwalificeerde meerderheden.** Een voorstel dat een minimale opkomst vereist om te worden opengesteld (bv. < 2⁄3 opkomst → niet in stemming), toetst tegen dezelfde **vergadering-brede** presentiegrondslag uit punt 2 — niet tegen per-ronde uitgebrachte stemmen.

## Overwogen alternatieven

- **Quorum per ronde uit uitgebrachte stemmen** (huidige code). Afgewezen: juridisch onjuist; quorum is een vergadering-breed presentiebegrip dat de voorzitter vooraf vaststelt, niet een functie van wie in een ronde stemt.

## Gevolgen

- **Codex (actie A7):** verplaats quorum naar vergaderingsniveau. Schema: een vergadering-brede quorumstaat (vastgesteld ja/nee, grondslag-gewicht, `set_by`/`set_at`, geauditeerd op servertijd-UTC). Een expliciete voorzittersactie zet 'm vóór de eerste ronde, op basis van presentie (`attendance`) + ingeleverde machtigingen. Haal de quorumberekening uit `calculateVoteResult` (behoud de meerderheidsberekening); de ronde-uitslag rapporteert de bevroren vlag. Exacte integerrekenkunde (ADR-0008 §3) blijft.
- **Mistral (M1):** testdatasets bevatten presentie- én machtigingsscenario's zodat de quorumvaststelling toetsbaar is.
- **Cross-check (Bas/Codex, apart traject):** mogelijk staat dezelfde fout in fase 1 (`alv_presentie_stemmen_app` / ALV-STEM-APP). Verifiëren en zo nodig corrigeren; valt buiten fase-2-scope maar is gesignaleerd.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
