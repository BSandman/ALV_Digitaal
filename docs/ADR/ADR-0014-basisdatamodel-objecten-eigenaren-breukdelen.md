# ADR-0014 — Basisdatamodel: objecten (appartementsrechten), eigenaren en breukdelen

**Status:** geaccepteerd
**Datum:** 12 augustus 2026
**Beslisser:** Bas (domein/juridisch); vastgelegd door Claude (Architect & Validator)
**Context-links:** [[ADR-0006]] (stem hoort bij appartementsrecht), [[ADR-0008]] (multi-VvE-rechten, nooit samenvoegen, exacte rekenkunde), [[ADR-0016]] (auth-model). Bron-data: TwinQ-export (`owners.js`) / `adressen eigenaars/samengevoegd_eigenaren_breukdelen_TF_NB_PG.csv`.

## Context

Het schema (`participant`/`entitlement`) bestond al, maar zonder vastgelegd besluit over wát de anker-entiteit is, hoe een breukdeel ontstaat, hoe eigenaren eraan hangen, en hoe parkeren administratief aan een woning koppelt. Zonder dat besluit is de TwinQ-import en de latere koppeling met het operationele parkeersysteem (HonigParkeren) ongedefinieerd. Deze ADR legt het basisdatamodel vast.

## Besluit

### 1. Het object (appartementsrecht) is de anker-entiteit

De centrale entiteit is het **object**: een **woning** of een **parkeerplek**, elk een zelfstandig appartementsrecht. Niet de persoon en niet het adres zijn het anker — het object is het.

- Elk object behoort tot **exact één** splitsing: **TF** (transformatie), **NB** (nieuwbouw) of **PG** (parkeren).
- Elk object heeft **1:1 een breukdeel** = zijn stemgewicht binnen die splitsing.

### 2. Breukdeel = GBO-aandeel, 1:1 met het object

Het breukdeel van een object is zijn aandeel in het gebruiksoppervlak:

```
breukdeel(object) = GBO(object) / GBO(totaal van de splitsing/VvE)
```

De GBO-verhouding is de **grondslag**; de opgeslagen waarde is het **breukdeel zelf** (`entitlement.weight`, `DECIMAL(12,4)`, exact — ADR-0008). Het breukdeel wordt niet in de app herberekend uit GBO; de TwinQ-bron levert het reeds berekend. Breukdelen zijn **per splitsing** geschaald (TF ~30–68, NB ~11–20, PG ~15,67 vrijwel gelijk per plek) en dus alleen relatief binnen hun eigen splitsing zinvol — quorum en meerderheid rekenen per splitsing (ADR-0008).

### 3. Eigenaar 1:1 met object; eigenaar mag meerdere objecten houden

Elk object heeft **1:1 één eigenaarstitel** (persoon, echtpaar/mede-eigenaars, of bedrijf zoals Sabio Invest BV). Vanuit het object gezien is er dus precies één eigenaar. Andersom mag één eigenaar **meerdere objecten** houden — typisch een TF- of NB-woning **plus** een PG-plek. Elk object behoudt zijn **eigen breukdeel** en wordt **per splitsing** apart geteld; rechten worden **nooit** tot één gewicht samengevoegd (bevestigt ADR-0006/0008). De eigenaar brengt echter per stemronde **één** stemactie uit die op al zijn in-scope rechten wordt toegepast — niet één knop per recht (zie [[ADR-0018]]).

### 4. Parkeerkoppeling is administratief en gewichtloos

Een PG-object (plek) kan administratief gekoppeld zijn aan een TF- of NB-woning via `PG_gekoppeld_aan`. Deze koppeling is:

- **1:0..n** vanuit de woning: een woning heeft nul, één of meer gekoppelde plekken; sommige NB-objecten (bijv. Zuideinde 74H) hebben géén PG-plek.
- **puur administratief**: de koppeling heeft **geen** invloed op stemgewicht, quorum of stemgedrag. Het PG-recht stemt zelfstandig in de PG-splitsing.

### 5. Bron van waarheid = TwinQ

De TwinQ-export (`owners.js`, identiek aan de samengevoegde CSV) is de bron. Per objectregel levert de kolom `VVE_lidmaatschap` de geldige combinaties (`"TF;PG"`, `"NB;PG"`, of `"NB"`); elk lidmaatschap-deel wordt **één object/entitlement** met eigen `splitsing_code` + breukdeel + eigenaarstitel.

## Mapping op het bestaande schema

- **`entitlement`** = het object: `splitsing_code` ∈ {TF, NB, PG}, `weight` = breukdeel (1:1 met het object).
- **`participant`** = de eigenaarstitel/login-representatie; `participant` 1:N `entitlement` (een eigenaar met woning + plek → twee entitlements). Vanuit het object blijft het 1:1.
- **`power_of_attorney`** hangt per `entitlement` (per object), niet per persoon — consistent met ADR-0008.
- **Koppelsleutel HonigParkeren** = huisnummer + toevoeging (bijv. `78G`). Bruikbaar als *join* naar het operationele parkeersysteem (kentekens/plekken per woning), **niet** als primaire sleutel: hij is niet globaal uniek (bijv. `80E`, `82B` komen dubbel voor) en is fase-later/operationeel, buiten de stem-scope.

## Overwogen alternatieven

- **Persoon als anker (bundelen per eigenaar).** Afgewezen: verhult de aparte objecten/splitsingen en botst met ADR-0006/0008; identiteitsresolutie is bovendien fragiel bij dubbele/lege e-mails, mede-eigenaars en BV's.
- **Adres als anker.** Afgewezen: een adres kan meerdere rechten (woning + plek, of dubbele bewoners) dragen; het adres is een attribuut, niet de eenheid van stemrecht.
- **Parkeerbreukdeel optellen bij de woning.** Afgewezen: PG is een zelfstandige splitsing met eigen quorum; samentellen zou stemrecht vervalsen.

## Gevolgen

- **Codex:** de TwinQ→DB-import (converter `owners.js` → objecten/eigenaren, taak #17) volgt dit model: één entitlement per (object × splitsing), eigenaarstitel als participant, `PG_gekoppeld_aan` als administratief attribuut zonder gewichtseffect. Niet groeperen op e-mail. Breukdeel exact overnemen (geen float).
- **Gemini:** testdata/asserts dekken een eigenaar met woning + gekoppelde plek (twee losse stemmen), een woning zónder plek, en een BV met meerdere objecten.
- **Mistral:** synthetische (T) en gepseudonimiseerde (A) datasets behouden de object-anker-structuur en de PG-koppeling; GBO/breukdeel-waarden blijven exact.
- **Bas:** data-kwaliteit van de bron (dubbele/ontbrekende e-mailadressen per objectregel, `Controle_opmerking`-kolom) is een aparte import-/schoonmaakstap vóór livegang; valt buiten dit model-besluit.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
