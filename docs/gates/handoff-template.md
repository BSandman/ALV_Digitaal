# Handoff — <van rol> → <naar rol>

**Datum/tijd (UTC):**
**Versie/commit:**

Iedere overdracht bevat minimaal deze zes onderdelen (v0.1.0 §10):

## 1. Doel
<Wat is er gedaan en waarom; welk deel van de specificatie/acceptatiecriteria.>

## 2. Gewijzigde bestanden
<Lijst van paden. Geen twee AI's wijzigen gelijktijdig hetzelfde bronbestand.>

## 3. Testbewijs
<Regressietests, functionele tests, belastingstest-resultaten. Groen/rood + cijfers.>

## 4. Privacyclassificatie (Mistral-gate)
<Bevat de diff/fixtures persoonsgegevens? Nee = doorgaan. Ja = stop + toelichting.>

## 5. Open risico's
<Bekende beperkingen, aannames, te verifiëren punten.>

## 6. Rollback
<Hoe draai je deze wijziging terug? Ontbrekende rollback = release-stop (Mistral).>

---

**Gate-uitslag:**
- [ ] Claude — architectuurregels (ADR-0002) & domeinvalidatie
- [ ] Gemini — functionele/apparaat-/belastingstest
- [ ] Mistral — privacy- & integratiegate
- [ ] Bas — go/no-go
