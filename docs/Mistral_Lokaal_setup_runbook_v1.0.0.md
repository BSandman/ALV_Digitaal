# Mistral Lokaal — setup-runbook (parallel uit te voeren) — v1.0.0

**Datum:** 10 augustus 2026
**Voor:** Bas — parallel aan de eerste OTAP-stappen
**Rol Mistral in het project:** Integrator & AVG-gatekeeper + deployer, nu als **lokaal draaiend** model
**Waarom lokaal:** Mistral raakt de echte eigenaarslijst (pseudonimisering) en scant op PII. Dat mag een cloud-API niet zien. Lokaal draaien betekent: **echte PII verlaat jouw machine nooit.**

> Dit is een doe-runbook met beslispunten. Werk het van boven naar beneden af. Waar een keuze afhangt van jouw hardware, staat een beslistabel. Je hoeft niet alles in één keer: fase A (installeren + model draaien) is genoeg om te starten; fase B en C (taken + inpluggen) volgen zodra Codex de scaffold klaar heeft.

---

> **Status 10 aug 2026: fase A en B afgerond.** Ollama `0.32.6`, `mistral-nemo:latest` (12,2B, Q4_0), 7,59 GB VRAM volledig GPU-resident, API-test = `OK`, terugval `mistral` 7B beschikbaar, veilige mappen aangemaakt (`secure/`+`out/` in `.gitignore`). Gebruik een **nieuw PowerShell-venster** voor `ollama`. Volgende: **fase C** (de drie scripts) — zie `docs/gates/Mistral-instructie.md`.

## Fase A — Mistral lokaal draaiend krijgen

### A1. Hardware-check (bepaalt het model)

Draai dit even zodat je weet wat je machine aankan. Windows PowerShell:

```powershell
# RAM (GB)
(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB
# GPU + videogeheugen (VRAM)
Get-CimInstance Win32_VideoController | Select-Object Name, @{N='VRAM_GB';E={[math]::Round($_.AdapterRAM/1GB,1)}}
```

`AdapterRAM` klopt niet altijd voor moderne GPU's; kijk voor de zekerheid ook in **Taakbeheer → Prestaties → GPU** naar "Toegewijd GPU-geheugen".

### A2. Modelkeuze (beslistabel)

> **Gepind voor Bas (10 aug 2026):** hardware = RTX 4070, **12 GB VRAM** + 32 GB DDR5. Gekozen model: **`mistral-nemo` (12B), Q4** — ~7 GB VRAM, volledig GPU-resident, ruimte over voor context. `mistral-small` (22–24B) bewust níét: past bij Q4 niet volledig in 12 GB en valt terug op CPU. `mistral` (7B) blijft de veilige terugval.

De vuistregel: het model moet in je (V)RAM passen in een gekwantiseerde vorm (Q4 = ~0,55 GB per miljard parameters). Kies de zwaarste rij die comfortabel past.

| Jouw situatie | Model | Waarom |
|---|---|---|
| GPU met **≥12 GB VRAM** | `mistral-nemo` (12B) of `mistral-small` | Beste redeneer-/instructiekwaliteit voor pseudonimisering en scan-beoordeling |
| GPU met **6–8 GB VRAM**, of 16–32 GB RAM zonder zware GPU | `mistral` (7B Instruct, Q4) | Degelijk, draait vlot; prima voor deze taken |
| **Weinig VRAM / oudere laptop** (≤16 GB RAM) | `mistral` (7B, Q4) op CPU | Werkt, trager; voor batchtaken (data genereren) is snelheid niet kritiek |

Belangrijk: voor de **PII-scan** (fase C) is een LLM niet eens strikt nodig — dat is vooral deterministische regex/patroonmatching. Het model is vooral nuttig voor het *genereren* van geloofwaardige synthetische data en het *beoordelen* van randgevallen. Kies dus liever betrouwbaar-en-lokaal boven groot-en-traag.

### A3. Installeren — route 1: Ollama (aanbevolen, eenvoudigst)

Ollama is de makkelijkste weg op Windows en geeft meteen een lokale API op `http://localhost:11434` die scripts kunnen aanroepen.

1. Installeer Ollama van `https://ollama.com/download` (Windows-installer). Verifieer de download bij de officiële bron; fetch geen modellen via omwegen.
2. Haal het gekozen model en test:

```powershell
ollama pull mistral            # of: ollama pull mistral-nemo
ollama run mistral "Zeg in één zin: lokaal draaien werkt."
```

3. Snelle API-test (dit endpoint gebruiken de latere scripts):

```powershell
curl http://localhost:11434/api/generate -d '{ "model": "mistral", "prompt": "Antwoord met OK", "stream": false }'
```

### A3-alt. Route 2: llama.cpp (meer controle, meer werk)

Alleen kiezen als je bewust fijnmazige controle over kwantisatie/offloading wilt. Download een GGUF-Q4-versie van het Mistral-model, draai `llama-server` en richt de scripts op dat endpoint. Voor dit project geeft route 1 hetzelfde resultaat met minder onderhoud; begin met Ollama tenzij je een reden hebt.

### A4. Air-gap-gewoonte voor PII-werk

Als je later de **echte** lijst pseudonimiseert (fase C2): doe dat het liefst met de netwerkverbinding uit of met de zekerheid dat het model volledig lokaal draait (Ollama praat niet naar buiten voor inferentie). Vuistregel: **geen enkele stap die echte PII aanraakt mag een cloud-API of externe URL bevatten.**

---

## Fase B — Mappen en veilige opslag

Richt onder de projectroot een werkmap in voor Mistral Lokaal, met een deel dat **nooit** in Git komt:

```
D:\Bas_en_AIs\VvE_Werk\Platform\ALV_Digitaal\
  mistral-lokaal\
    scripts\            # generatoren en scan (wel in Git)
    out\synthetic\      # synthetische T-data (wel deelbaar)
    secure\             # echt→pseudoniem-mapping + echte lijst  <-- NOOIT in Git
```

Voeg aan `.gitignore` toe (indien nog niet aanwezig):

```
mistral-lokaal/secure/
mistral-lokaal/out/
```

De map `secure/` is de enige plek waar de echt→pseudoniem-mapping en (kopieën van) de echte lijst mogen staan. Die map verlaat je machine niet en gaat niet naar mijn.host.

---

## Fase C — De drie taken van Mistral

Dit zijn de taken die Mistral in de OTAP-keten vervult. Codex bouwt de definitieve scripts en hangt ze in CI/deploy; onderstaande skeletten laten zien wat elk doet en wat de invoer/uitvoer is, zodat jij ze kunt uitproberen zodra het model draait.

### C1. Synthetische data genereren (voor T)

**Doel:** een volledig fictieve eigenaarsset met realistische structuur voor Test — huisnummer+toevoeging, breukdelen die optellen tot het geheel, stemgewichten, ondersplitsingen, meerdere rechten per eigenaar. Geen relatie tot echte personen.

**Aanpak:** het meeste is deterministische generatie (namen uit een fictieve namenlijst, adressen fictief, breukdelen wiskundig sluitend). Mistral gebruik je om variatie en geloofwaardigheid toe te voegen (realistische Nederlandse namen, plausibele randgevallen). Uitvoer: `out/synthetic/owners.synthetic.json`. Deze mag vrij in T en CI gebruikt worden.

**Kwaliteitseis:** de gegenereerde set moet dezelfde *vorm* hebben als het productieschema (dezelfde velden), zodat een test op synthetisch 1-op-1 vertaalt naar productie.

### C2. Pseudonimiseren (voor A)

**Doel:** uit de echte lijst een set afleiden met **behoud van structuur en stemgewicht**, maar met gemaskeerde identiteit (naam, adres, e-mail vervangen). Zo test A quorum en meerderheden tegen de echte breukdelen, zonder echte identiteiten bloot te stellen.

**Harde regels:**

- Invoer (echte lijst) en de **mapping** echt↔pseudoniem staan uitsluitend in `secure/`.
- De mapping is deterministisch (zelfde eigenaar → zelfde pseudoniem over runs) zodat A reproduceerbaar is, maar wordt **nooit** gedeeld of gecommit.
- Uitvoer (`owners.pseudo.json`) bevat geen herleidbare PII en gaat naar A; de sleutel om terug te herleiden blijft lokaal.
- Draai deze stap bij voorkeur offline (zie A4).

**Rol van het model:** consistente, plausibele vervangnamen/-adressen genereren die niet toevallig naar een echte persoon wijzen. Het rekenkundige deel (gewichten, breukdelen behouden) is code, geen LLM.

### C3. PII-scan (de gate)

**Doel:** blokkeer promotie als er echte persoonsgegevens lekken in de diff, de fixtures of het te uploaden release-artefact. Dit is de gate die het `owners.js`-in-dist-lek uit ADR-0005 had gevangen.

**Aanpak:** primair deterministisch — scan op patronen (e-mailadressen, bekende echte achternamen/straatnamen uit de VvE, bestandsnamen als `owners.js`/`owners.initial.js`, `events.json`, `audit.log`, snapshots) in:

1. de git-diff van de release;
2. de testfixtures;
3. de inhoud van het gebouwde zip-artefact.

Exitcode ≠ 0 laat de CI/deploy falen. Het model gebruik je optioneel als tweede paar ogen op randgevallen ("ziet dit eruit als een echte naam?"), niet als enige oordeel — determinisme eerst.

**Inpluggen:** deze scan draait als blokkerende stap in `scripts/deploy.sh` (vóór upload naar A en P) en als CI-stap bij de T→A-poort.

---

## Fase D — Inpluggen in OTAP (samenvatting)

| Taak | OTAP-moment | Uitvoer gaat naar |
|---|---|---|
| C1 Synthetisch genereren | vóór/tijdens T | T-database (lokaal) + CI-fixtures |
| C2 Pseudonimiseren | bij T→A-promotie | A-database op mijn.host |
| C3 PII-scan | poort T→A en A→P | blokkeert deploy bij lek |
| Deploy uitvoeren | T→A en A→P | mijn.host via `scripts/deploy.sh` |

---

## Wat ik van jou nodig heb om dit af te ronden

1. **Hardware-uitkomst** (A1): dan bevestig ik de exacte modelkeuze.
2. Bevestiging dat **Ollama** de gewenste route is (anders richt ik de scripts op llama.cpp).
3. Zodra Codex de scaffold klaar heeft, laat ik de drie scripts (C1–C3) definitief bouwen en aan CI/deploy hangen.

Start alvast met A1–A3; de rest kan volgen zonder je te blokkeren.
