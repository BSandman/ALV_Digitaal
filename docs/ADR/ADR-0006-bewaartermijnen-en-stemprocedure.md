# ADR-0006 — Bewaartermijnen, datamodel "stem door appartementsrecht" en stemvaststelling

**Status:** geaccepteerd (inhoudelijke lijn door Bas, 10 aug 2026); één juridisch punt nog te bevestigen (§ Open punt)
**Datum:** 10 augustus 2026
**Beslisser:** Bas (juridische/menselijke poort); vastgelegd door Claude (Architect & Validator)
**Context-links:** [[ADR-0002]] (shared-hosting-regels, atomair sluiten), [[ADR-0004]] (OTAP + testdata), [[ADR-0005]] (PII buiten release)

## Context

Fase 2 verwerkt stemgedrag van geïdentificeerde eigenaren. v0.2.0 §2.2 markeerde bewaartermijnen en een verwerkingsregister als openstaande, uitsluitend menselijke beslissing. Bas heeft de lijn nu bepaald. Kern: een stem hoort juridisch bij het **appartementsrecht**, niet bij de persoon. Ten tijde van de ALV brengt een persoon namens dat recht de stem uit; die persoon kan later huis én recht verkopen, maar de uitgebrachte stem van dat recht blijft historisch staan.

## Besluit

### 1. Datamodel — stem is van het recht, persoon is momentopname

Een stem wordt vastgelegd als: **"stem door appartementsrecht X, ten tijde van de ALV vertegenwoordigd door [persoon]"**. Concreet:

- De stem verwijst naar het **appartementsrecht** (stabiele sleutel) en het bijbehorende **stemgewicht/breukdeel** zoals dat gold op de ALV-datum.
- De vertegenwoordigende persoon wordt als **momentopname** (snapshot op ALV-datum) aan de stem gekoppeld, niet als levende foreign key. Verkoopt de persoon het recht, dan blijft de historische stem intact; de koppeling persoon↔recht is tijdgebonden.
- De koppeling persoon↔recht leeft dus in een aparte, tijdgebonden relatie, niet hard in het stemrecord.

### 2. Bewaartermijnen — twee sporen

**Spoor A — ALV-resultaat (formeel VvE-archief): 7 jaar.** Agenda, stemvoorstellen, notulen, de uitgebrachte stemmen en het resultaat worden als bevroren geheel 7 jaar bewaard. Dit is de gezaghebbende, onveranderlijke vastlegging van het besluit.

**Spoor B — persoonsdata (operationeel account/contact): variabel.** Contactgegevens, e-mail en inloggegevens van een persoon blijven bestaan zolang de persoon eigenaar is, en worden verwijderd **2 jaar nadat** die persoon al zijn/haar verplichtingen jegens de VvE heeft voldaan.

De twee sporen worden technisch gescheiden: het bevroren ALV-resultaat (spoor A) leunt niet op de levende persoonstabel (spoor B). Zo kan spoor B opgeschoond worden zonder het formele archief te breken. Retentie-hooks (velden + opschoonscript) worden hierop ingericht; servertijd-UTC is leidend (ADR-0002 regel 5).

### 3. Stemvaststelling door de voorzitter

Na het sluiten van een ronde is er een expliciete, vastgelegde stap vóór het besluit definitief is:

1. Iedereen heeft gestemd; de voorzitter **sluit** de ronde.
2. De server bevriest de ronde en berekent de uitkomst **atomair in één transactie** (ADR-0002 regel 3) — dit is de door het systeem verzamelde uitkomst.
3. De voorzitter **verifieert** de door het systeem verzamelde uitkomst tegen het besluitvoorstel.
4. De voorzitter **stelt de stemming vast**. Deze vaststelling is een aparte, geauditeerde gebeurtenis ("vastgesteld door voorzitter op [servertijd-UTC]") en maakt het besluit pas definitief.

"Ronde gesloten" en "stemming vastgesteld" zijn dus twee onderscheiden toestanden; alleen vaststelling levert het formele besluit dat naar spoor A gaat.

## Overwogen alternatieven

- **Stem koppelen aan de persoon (levende FK).** Afgewezen: bij verkoop/verwijdering van de persoon zou de historische stem breken of ten onrechte meeverdwijnen; juridisch hoort de stem bij het recht.
- **Één bewaartermijn voor alles.** Afgewezen: het formele besluitarchief (7 jaar) en de operationele persoonsgegevens (ownership +2 jaar) hebben een verschillende grondslag en horen apart opgeschoond te worden.
- **Sluiten = vaststellen (één stap).** Afgewezen: de voorzitter moet uitkomst en besluitvoorstel expliciet kunnen verifiëren vóór het besluit vaststaat; dat vraagt een aparte toestand.

## Gevolgen

- Codex modelleert stem, appartementsrecht en persoon als drie entiteiten met een tijdgebonden vertegenwoordigingsrelatie; het stemrecord bevat een persoons-snapshot, geen levende verwijzing.
- Twee opschoonpaden met eigen retentie; het bevroren ALV-resultaat is zelfstandig leesbaar zonder de persoonstabel.
- De app krijgt een expliciete toestand "vastgesteld door voorzitter"; dit wordt een acceptatiecriterium (Claude) en testbaar (Gemini).
- Deze regels voeden het verwerkingsregister/DPIA-notitie (menselijke taak, Bas).

## Open punt (ter bevestiging door Bas — juridisch, geen AI-besluit)

De notulen (spoor A, 7 jaar) leggen doorgaans vast wie namens welk recht aanwezig was en stemde. Dat betekent dat de **naam van de vertegenwoordiger als onderdeel van het bevroren ALV-resultaat** 7 jaar bewaard blijft, óók nadat het operationele persoonsprofiel (spoor B) is opgeschoond. Architectonisch is dat verenigbaar (de naam in spoor A is een momentopname in het formele archief, los van het levende profiel). Te bevestigen: is dit de gewenste juridische lijn, of moet de vertegenwoordigersnaam in het 7-jaars-archief na afloop van spoor B gepseudonimiseerd worden?
