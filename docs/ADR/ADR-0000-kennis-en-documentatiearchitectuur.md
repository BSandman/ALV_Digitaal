# ADR-0000 — Kennis- & documentatiearchitectuur (bijbel-index + Raakt:-conventie)

**Status:** geaccepteerd
**Datum:** 2026-08-23
**Beslisser:** Bas + Claude (Architect)

Meta-ADR: dit besluit gaat niet over het product maar over hóe onze kennis is
geordend. Daarom nummer 0000 — het staat vóór en boven de genummerde reeks.

**Raakt:** `bijbel.md` (§0, §9) · `AGENTS.md` (onveranderlijke minimumregels) ·
`docs/gates/handoff-template.md` · elke nieuwe ADR/spec/module/taakdoc (conventie).

## Context

De bijbel groeide richting "territorium": detail én register in één document,
het register (§9) als platte one-liners. Twee kosten daarvan:

1. **Geen look-ahead.** Wie een besluit wijzigt, ziet niet vooraf wélke andere
   delen dat raakt. Koppelingen zijn impliciet → we ontdekken ze pas als iets
   breekt. "We schieten onszelf in de voet."
2. **Junior/medior-gevoel.** Niet alleen de architect, ook de developer moet
   vóór de start weten wat een keuze betekent en wat het gevolg is van afwijken.
   Zonder dat blijft elke rol keuzes maken zonder de consequenties te overzien.

## Besluit

1. **Bijbel = kaart, geen territorium.** `bijbel.md` bevat de *verwijzende index*
   plus de harde, projectbrede invarianten. Alle detail staat in losse ADR's en
   specs; de bijbel verwijst ernaar en dupliceert ze niet.

2. **`Raakt:`-regel verplicht.** Elke ADR, spec, module en taakdoc draagt op een
   vaste plek een `Raakt:`-regel: **forward-links** naar de delen die dit stuk
   raakt (andere ADR's, specs, modules, invarianten). Dit ís de look-ahead —
   wie het stuk opent, ziet meteen wat een wijziging verderop raakt, vóór de
   start. Vaste vorm: `**Raakt:** <link> · <link> · …` met een reden waar nodig
   (bv. "vervangt", "breidt uit", "implementeert").

3. **Register = traverseerbare index (de parelketting).** `bijbel.md` §9 is geen
   platte lijst meer: elke entry draagt zijn eigen `Raakt:`-keten, zodat je van
   besluit naar besluit kunt aflopen.

4. **Ketenlengte = kwaliteitssignaal.** Een korte `Raakt:`-keten = schone grenzen,
   lage koppeling. Een lange, steeds groeiende keten = een smell: het besluit
   doet te veel of de grens zit verkeerd. Link alleen echte, dragende koppelingen
   (supersedes / breidt uit / hangt af van / implementeert), niet "vaag verwant".

5. **Voorkeur-met-gevolg.** Elke open keuze in een taakdoc of ADR krijgt de
   **voorkeursoptie** mee én het **gevolg van afwijken**. Zo handelt ook de
   developer senior: hij weet wat de bedoeling is en wat het kost om ervan af te
   wijken, in plaats van stilzwijgend de andere optie te kiezen.

6. **Forward primair, back-link via check.** Forward-links (`Raakt:`) zijn de
   bron van waarheid. Terugverwijzingen worden niet handmatig bijgehouden maar
   af en toe via een consistentiecheck afgeleid (voorkomt dubbel onderhoud/drift).

## Overwogen alternatieven

- **Volledige back-link-graaf handmatig onderhouden** — afgewezen: dubbel
  onderhoud, drift zodra iemand één kant vergeet.
- **Alles in de bijbel houden (territorium)** — afgewezen: het document groeit
  dicht, detail en index raken verweven, register onleesbaar.
- **Vrije-vorm "zie ook"-verwijzingen** — afgewezen: niet traverseerbaar, geen
  meetbaar ketenlengte-signaal.

## Gevolgen

Positief: elke rol krijgt vóór de start de look-ahead; koppeling is expliciet en
zichtbaar; ketenlengte wordt een meetbare smell-meter; de bijbel blijft kort.

Negatief: discipline vereist — elke nieuwe ADR/spec/taakdoc moet zijn `Raakt:`
onderhouden en open keuzes voorzien van voorkeur + gevolg. Afgedwongen via
AGENTS.md (onveranderlijke minimumregels).
