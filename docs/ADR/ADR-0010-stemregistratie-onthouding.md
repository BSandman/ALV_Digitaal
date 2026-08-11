# ADR-0010 — Stemregistratie: niet/te laat gestemd = onthouding

**Status:** geaccepteerd
**Datum:** 11 augustus 2026
**Beslisser:** Bas (domein); vastgelegd door Claude (Architect & Validator)
**Context-links:** [[ADR-0006]] (stem hoort bij het recht), [[ADR-0008]] (exacte rekenkunde), [[ADR-0009]] (quorum vergadering-breed, deelnemende set)

## Context

Bij het corrigeren van het quorummodel (ADR-0009) hoort de vraag: wat gebeurt er met een deelnemend recht (aanwezig of via machtiging) dat in een ronde géén stem uitbrengt vóór sluiting? Bas heeft dit vastgesteld.

## Besluit

1. **Keuzes in een ronde:** Voor, Tegen, Blanco, Onthouding.
2. **Niet of te laat gestemd = Onthouding.** Een recht uit de deelnemende set (aanwezigen + ingeleverde machtigingen/stemformulieren, ADR-0009) dat vóór sluiting geen geldige stem heeft uitgebracht, wordt bij sluiting als **Onthouding** vastgelegd — geauditeerd op servertijd-UTC. Niet als "ontbrekend".
3. **Gelijk aan een blanco stemformulier.** Deze onthouding heeft hetzelfde effect als een papieren stemformulier dat blanco wordt ingediend: **niet-beslissend**. Zowel Blanco als Onthouding tellen **niet** mee in de meerderheidsnoemer (die blijft `voor + tegen`, ADR-0008 §3).
4. **Volledige ronde-uitslag.** Hierdoor is de ronde-uitslag volledig over de deelnemende set: binnen de vergaderingsdeelname bestaan geen niet-geregistreerde gerechtigden.

## Overwogen alternatieven

- **Niet-stemmers weglaten uit de uitslag.** Afgewezen: maakt de ronde-uitslag onvolledig t.o.v. de vastgestelde deelname en verhult wie zich onthield; de voorzitter moet een sluitend beeld hebben.
- **Niet-stemmen als "afwezig" behandelen.** Afgewezen: het recht is deel van de vastgestelde presentie (ADR-0009); afwezigheid is een quorumbegrip, geen ronde-uitkomst.

## Gevolgen

- **Codex (bij A7):** registreer bij sluiting voor elk deelnemend recht zonder geldige tijdige stem een **Onthouding** (geauditeerd). De meerderheid blijft berekend over `voor + tegen`; Blanco en Onthouding blijven niet-beslissend. Voeg tests toe die dit vastpinnen (deelnemer stemt niet → onthouding in de uitslag; onthouding/blanco raken de meerderheidsnoemer niet).
- **Gemini/Mistral:** testdata/-scenario's bevatten deelnemende rechten die niet stemmen, om de auto-onthouding te dekken.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
