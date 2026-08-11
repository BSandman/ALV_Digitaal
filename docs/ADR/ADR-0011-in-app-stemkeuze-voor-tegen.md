# ADR-0011 — In-app stemkeuze: alleen Voor/Tegen; onthouding en blanco alleen als resultaat

**Status:** geaccepteerd
**Datum:** 11 augustus 2026
**Beslisser:** Bas (UX/domein); vastgelegd door Claude (Architect & Validator)
**Context-links:** [[ADR-0010]] (niet/te laat = onthouding), [[ADR-0006]] (stem hoort bij het recht)

## Context

Bij het vastleggen van de stemregistratie (ADR-0010) hoort de invoerkant: welke keuzes biedt de app de eigenaar aan? Bas heeft dit als UI/UX-regel vastgesteld.

## Besluit

1. **Twee knoppen.** Het in-app stemscherm biedt uitsluitend **Voor (Ja)** en **Tegen (Nee)**. Er is géén knop voor Blanco of Onthouding.
2. **Onthouding is afgeleid, geen invoer.** Een deelnemend recht dat niet of te laat stemt, wordt bij sluiting als **Onthouding** vastgelegd (ADR-0010). Onthouding is dus nooit een keuze die de eigenaar indient.
3. **Blanco is geen in-app keuze.** Blanco bestaat uitsluitend via een fysiek stemformulier (admin-/papierpad), niet in de app.
4. **Alleen als resultaat zichtbaar.** In-app verschijnen Blanco en Onthouding uitsluitend in de **uitslagweergave** (als telling), nooit als invoerknop.

## Overwogen alternatieven

- **Vier knoppen (Voor/Tegen/Blanco/Onthouding).** Afgewezen: overbodige en verwarrende keuzes; niet-stemmen dekt onthouding al af, en blanco hoort bij het papieren formulier.

## Gevolgen

- **Frontend:** het stemscherm toont exact twee acties (Voor/Tegen); de uitslag toont wél alle vier de tellingen.
- **Backend (kleine bewaking, A8):** het eigenaar-steminvoerpad (`recordVote`) accepteert uitsluitend `voor`/`tegen`; een ingediende `blanco`/`onthouding` wordt op dit pad geweigerd. Blanco komt via het admin-/stemformulierpad; onthouding is afgeleid bij sluiting. Tests dekken de weigering.
- Het datamodel houdt alle vier de keuzes als geldige *resultaat*-toestanden (ADR-0008/0010); dit besluit beperkt alleen de *invoer* via de app.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
