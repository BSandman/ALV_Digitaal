# OTAP-opzet — digitaal ALV-eigenaarportaal (fase 2) — v1.0.0

**Datum:** 10 augustus 2026
**Rol auteur:** Claude — Architect & Validator
**Status:** voorstel ter beoordeling door Bas
**Bouwt voort op:** `Architectuur_en_infravoorstel_v0.2.0.md`, `Eerste_opzet_digitale_ALV_eigenaarportaal_v0.1.0.md`, ADR-0001 t/m ADR-0003
**Beslissingen Bas (10 aug 2026):** O+T lokaal (Docker), A+P op mijn.host; testdata synthetisch in T en gepseudonimiseerd in A; Mistral draait lokaal (aparte runbook); `owners.js` moet uit het release-artefact.
**Nieuw in dit document:** ADR-0004 (OTAP-topologie + testdata), ADR-0005 (PII buiten release + provisioning), ADR-0006 (bewaartermijnen + stemprocedure).

---

## 1. Managementsamenvatting

v0.2.0 legde al twee omgevingen vast: een Docker-dev/test/CI die het productieplatform nabootst, en productie op mijn.host `.starter`. Dit document maakt daar een volwaardige **vier-traps OTAP** van door één schakel toe te voegen die nog ontbrak: een **Acceptatie**-omgeving op de echte hosting, met gepseudonimiseerde data, als laatste generale repetitie vóór livegang. De keten wordt:

**O**ntwikkeling (lokaal Docker) → **T**est (lokaal Docker) → **A**cceptatie (mijn.host, gepseudonimiseerd) → **P**roductie (mijn.host, echte data, gehard).

De grens tussen T en A is bewust de grens tussen "lokaal, synthetisch, snel" en "echte hosting, realistisch, streng". Alles wat mis kan gaan door het *platform* (Passenger cold start, MariaDB-`sql_mode`, `X-Forwarded-For`, entry-processlimieten) vang je pas echt in A; alles wat mis kan gaan door de *code* vang je goedkoop in O en T. Elke promotie heeft een expliciete poort met bewijs, en de vier AI-rollen uit v0.2.0 krijgen per trap een duidelijke taak. Mistral draait lokaal en is de spil van drie dingen die door de hele keten lopen: testdata maken, PII bewaken en deployen.

Dit document lost ook een acute bevinding op: de fase-1-build verscheept vandaag de **volledige live-eigenaarslijst mee in elke release-zip** (`data/live/owners.initial.js`, 64 KB; oudere builds zetten `owners.js` zelfs in `public/`). Dat is een AVG-lek dat we structureel dichten met ADR-0005.

---

## 2. Uitgangspunten (overgenomen, niet heropend)

Deze staan vast uit v0.1.0/v0.2.0/ADR's en zijn hier randvoorwaarde, geen discussie:

- Productie is mijn.host `.starter`, MariaDB **11.8.8** via lokale socket, Node **20**, achter Phusion Passenger. Docker is **uitsluitend** dev/test/CI (ADR-0001).
- De zes shared-hosting-architectuurregels (ADR-0002): alle state in de database, geen permanente verbindingen, atomair sluiten met `FOR UPDATE`, server-side row-level filtering, servertijd-UTC voor audit, geverifieerd client-IP.
- De app zet **per verbinding** een strikte `sql_mode`, zodat dev en productie identiek reageren ongeacht de serverdefault (ADR-0003).
- Vier-AI-gatemodel: **Codex** = Lead Developer, **Gemini** = Lead Tester, **Mistral** = Integrator & AVG-gatekeeper (nu lokaal), **Claude** = Architect & Validator. **Bas** houdt het finale go/no-go. Geen twee AI's wijzigen gelijktijdig hetzelfde bronbestand.

---

## 3. De vier omgevingen

| | **O — Ontwikkeling** | **T — Test** | **A — Acceptatie** | **P — Productie** |
|---|---|---|---|---|
| **Waar** | Lokaal, Docker Compose (basisrun) | Lokaal, Docker Compose (`--profile dev,loadtest`) | mijn.host `.starter`, apart subdomein | mijn.host `.starter`, productiesubdomein |
| **URL** | `https://localhost:8443` | `https://localhost:8443` (loadtest) | `acceptatie.honigfabriek.nl` | `portaal.honigfabriek.nl` |
| **Doel** | Bouwen, unit- en regressietests, snelle iteratie | Geïntegreerde test, 120-clients-burst, arch-regel-checks, CI-gates | Generale repetitie op echt platform, UAT/proefvergadering door Bas | Echte ALV |
| **Data** | Synthetisch (kleine seed) | **Synthetisch** (Mistral-gegenereerd, volledig fictief) | **Gepseudonimiseerd** (Mistral, echte structuur, gemaskeerde identiteit) | Echte eigenaars-PII, gehard (ADR-0005) |
| **DB-engine** | MariaDB 11.8.8 (container, pariteit) | MariaDB 11.8.8 (container) | MariaDB 11.8.8 (mijn.host) | MariaDB 11.8.8 (mijn.host) |
| **Primaire rol** | Codex | Gemini (+ Codex-CI) | Bas (UAT), Claude (validatie), Mistral (deploy) | Mistral (deploy), Bas (go/no-go) |
| **Mailgedrag** | Uit / dry-run | Dry-run, hard omgeleid | Dry-run of hard omgeleid naar `info@bdhw.nl` | Echt, uit eigenaarslijst |
| **Reset/flush** | Vrij | Vrij, per testrun | Alleen gecontroleerd, met snapshot | Alleen met dubbel herstelpunt (bestaande regel) |

Toelichting op de twee mijn.host-omgevingen: `.starter` biedt drie MariaDB-databases. A (`acceptatie.honigfabriek.nl`) en P (`portaal.honigfabriek.nl`) krijgen elk een **eigen database** en een **eigen subdomein/application root**, volledig gescheiden. A en P delen nooit een database, en A's gepseudonimiseerde set overschrijft nooit P en omgekeerd.

**Dispositie fase-1-domeinen (besluit Bas, 10 aug 2026).** `stem.honigfabriek.nl` en `stem-dev.honigfabriek.nl` waren Node.js-apps met JSON-opslag, **geen database** op mijn.host. De Node-app op `stem.honigfabriek.nl` wordt gestopt en vervangen door een statische **onderhoudspagina** (`Platform/stem_onderhoudspagina/index.html`) met vertraagde redirect naar `honigfabriek.nl`; `stem-dev` wordt gearchiveerd. Alle historische data zit in de `dist/vve-alv-app-v1.9.1.zip`, behalve de laatste (gesloten) vergadering, die als snapshot op `stem-live` in DirectAdmin staat. Doordat de app stopt, is `owners.js` **feitelijk al afgeschermd**: het bestand staat nog op mijn.host maar is niet meer via een applicatie benaderbaar. De structurele scheiding (ADR-0005) blijft niettemin de norm voor fase 2, en het fase-1-opschoontraject (PII uit de gearchiveerde zips) blijft aanbevolen.

---

## 4. Promotieflow met poorten

De richting is altijd één kant op: O → T → A → P. Terug kan alleen via een nieuwe iteratie, nooit door data of artefacten "terug te kopiëren". Elke pijl is een poort met bewijs; een poort zonder bewijs is dicht.

### 4.1 O → T (branch → main)

Codex levert een feature op een branch. Poort:

- unit- en regressietests groen (de gepinde ALV-rekenregels blijven leidend);
- Codex-zelfreview volgens de handoff-template;
- de geautomatiseerde **architectuurregel-checks** (ADR-0002) slagen in CI.

Dit is grotendeels een merge naar `main` binnen dezelfde lokale Docker-omgeving; O en T draaien op hetzelfde compose-bestand, T voegt de `dev`- en `loadtest`-profielen toe.

### 4.2 T → A (lokaal → echte hosting) — de zwaarste poort

Dit is de overgang van "onze machine, fictief" naar "echte hosting, gepseudonimiseerd". Poort:

- volledige CI groen: regressie + arch-regel-checks;
- **Mistrals PII-scan schoon** op de diff, de fixtures én het te uploaden release-artefact (ADR-0005 — geen echte `owners.js`, geen runtime-data in de zip);
- Gemini's 120-clients-belastingstest geslaagd, met vastgelegd bewijs;
- Claude's domeinvalidatie op quorum, PG-blok, machtigingen en stemrondes;
- release gebouwd uit **exact wat getest is**; versie getagd (`vX.y.z`).

Mistral deployt naar A via `scripts/deploy.sh` (SSH/rsync + `npm install --production` + Passenger-herstart — géén Docker naar productie) en provisioneert de **gepseudonimiseerde** dataset apart, buiten het artefact.

### 4.3 A → P (acceptatie → live) — menselijke poort

Techniek alleen is hier niet genoeg; dit is Bas' beslissing. Poort:

- Bas' UAT en ten minste één **proefvergadering** op A akkoord;
- **geteste** export- én herstelprocedure (een herstel dat niet geoefend is, bestaat niet — v0.2.0 §2.2);
- vóór de deploy twee herstelpunten: volledig archief van de application root + aparte kopie van de productiedata, met tijdstempel en SHA-256 (bestaande fase-1-regel, hergebruikt);
- Bas geeft expliciet **go**.

Mistral deployt naar P, provisioneert de **echte** PII apart en gehard (ADR-0005), en draait de post-deploy-verificatie (hashes, sync, tellingen, toelichtingen, eindbesluiten).

---

## 5. Rolverdeling per trap en Bas' werklus

Jouw voorkeurslus — *analyseren → beoordelen → plan maken → actie → review → plan aanpassen → periodiek doel verifiëren* — is precies de motor die per trap draait, met een andere hoofdrol:

- **Analyseren/beoordelen** — Claude (Architect). Schrijft acceptatiecriteria en ADR's, toetst implementaties aan de zes regels. Actief in elke trap, zwaarst vóór O en bij de T→A-poort.
- **Plan maken/actie** — Codex (Developer). Bouwt in O, levert via de handoff-template, draait de CI-checks. Enige die productcode wijzigt.
- **Review** — Gemini (Tester). Onafhankelijke QA en de belastingstest in T; herhaalt de proefvergadering op A.
- **Plan aanpassen/deployen/bewaken** — Mistral (Integrator & AVG-gatekeeper), lokaal. Maakt testdata, bewaakt PII, deployt naar A en P, dwingt de release-gate af.
- **Doel verifiëren** — Bas, op vaste momenten: de T→A-poort (bewijs compleet?) en de A→P-poort (go/no-go). Bas is de enige menselijke beslisser voor livegang, bewaartermijnen en de juridische lijn.

Kernregel blijft: productcode loopt via Codex, integratie/deploy via Mistral, en geen twee AI's raken tegelijk hetzelfde bestand.

---

## 6. Testdatastrategie (ADR-0004)

**T = volledig synthetisch.** Mistral genereert fictieve eigenaars met realistische *structuur* — huisnummer + toevoeging, breukdelen, stemgewicht, VvE-ondersplitsingen, meerdere rechten per eigenaar — maar zonder enige relatie tot echte personen. Dit maakt brede tests, edge-cases en de 120-clients-burst mogelijk zonder één byte echte PII lokaal of in CI.

**A = gepseudonimiseerd.** Voor een eerlijke generale repetitie moet A dezelfde *verdeling en gewichten* hebben als de echte VvE (anders test je quorum en meerderheden tegen fictieve breukdelen). Mistral leidt daarom uit de echte lijst een gepseudonimiseerde set af: structuur en stemgewicht blijven, identiteit (naam, adres, e-mail) wordt gemaskeerd. De **mapping van echt naar pseudoniem blijft strikt lokaal** op Bas' machine (bij Mistral Lokaal) en gaat nooit mee naar de hosting of naar Git.

**P = echt.** Alleen productie ziet echte PII, en die wordt apart geprovisioneerd en gehard (ADR-0005).

Waarom het toegangscode-formaat hierbij past: de door jou bedachte code `huisnummer+toevoeging-AAA-111-bb-!` is deels afgeleid van het object. In T zijn huisnummers fictief, dus codes ook. In A leidt het pseudoniem tot codes met dezelfde *vorm* maar losgekoppeld van echte adressen. In P zijn de codes gebonden aan eigenaar + ALV-datum + agenda-/voorstellenversie, net als de QR-binding in fase 1. Belangrijk aandachtspunt voor Codex: een toegangscode die deels het huisnummer bevat is **raadbaar**; hij moet dus altijd gecombineerd worden met server-side rate limiting en apparaatbinding (ADR-0002 regel 6), en het `-AAA-111-bb-!`-deel moet voldoende entropie en een serverzijdige hash krijgen. Dit wordt een acceptatiecriterium.

---

## 7. PII buiten het release-artefact (ADR-0005) — acuut

**Bevinding.** Elke fase-1-release-zip in `dist/` bevat `data/live/owners.initial.js` met de volledige live-eigenaarslijst (64 KB). Builds t/m v1.7.1 plaatsten `owners.js` zelfs in `public/`, wat door de webserver publiek geserveerd wordt. De PII reist dus mee in het artefact dat naar de hosting en (deels) naar de browser gaat.

**Principe voor fase 2.** Data en code worden gescheiden. Het release-artefact bevat **alleen code** — nooit `owners.*`, `events.json`, `audit.log`, `cycle.json`, snapshots of enige runtime-data. De eigenaarsdata leeft in de database (MariaDB) en/of in een bestand **buiten de webroot** met strakke rechten, en wordt **apart geprovisioneerd** door Mistral bij de deploy, per omgeving gescheiden.

**Gate.** Mistrals PII-scan is een harde poort bij T→A en A→P: faalt de build als er echte persoonsgegevens in de diff, de fixtures of het artefact zitten. Dit is exact het type lek dat de scan moet vangen.

**Status fase 1 (10 aug 2026).** De Node-app op `stem.honigfabriek.nl` wordt gestopt (zie §3), waardoor `owners.js` niet langer via een applicatie benaderbaar is — het directe lek is daarmee dicht. Het bestand staat echter nog op mijn.host en zit nog in de gearchiveerde `dist/*.zip`. **Aanbevolen, apart traject:** die zips opschonen/veilig archiveren buiten de repo en de resterende serverkopie van `owners.js` verwijderen of buiten de webroot verplaatsen. Voor fase 2 blijft scheiding van code en data de norm.

**Datamodel en bewaartermijnen (ADR-0006).** Een stem hoort bij het **appartementsrecht**, niet bij de persoon: vastgelegd als "stem door recht X, ten tijde van de ALV vertegenwoordigd door [persoon]". Dit scheidt twee retentiesporen — het bevroren ALV-resultaat (agenda, voorstellen, notulen, stemmen, resultaat: **7 jaar**) en de operationele persoonsdata (zolang eigenaar + **2 jaar** na voldane verplichtingen). De stemprocedure kent na het sluiten van een ronde een expliciete **vaststelling door de voorzitter**. Zie ADR-0006 voor het volledige besluit en het ene openstaande juridische punt.

---

## 8. Repo-strategie — advies

Je noemde de wens om later naar modules te gaan, met mogelijk een eigen repo per module, en vroeg mijn advies met oog op stabiliteit, veiligheid en deployment. Mijn advies: **nu één repo (modulaire monoliet), later polyrepo — met een expliciete extractie-trigger.** Per as:

**Stabiliteit.** De stemrekenregels raken zowel de beheer- als de deelnemerkant. In één repo is zo'n wijziging atomair: één commit, één test-run, geen versie-afstemming tussen repo's. Splits je te vroeg, dan moet elke cross-cutting wijziging over repo-grenzen gecoördineerd worden en breekt de atomiciteit precies op het gevoeligste stuk (de uitslag).

**Veiligheid.** Eén repo = één CI-pijplijn = één plek waar de PII-scan en de arch-regel-checks worden afgedwongen. Meer repo's vermenigvuldigen het oppervlak waar een lek als `owners.js`-in-dist opnieuw kan insluipen. Gezien §7 weegt dit zwaar.

**Deployment.** mijn.host draait per subdomein één Passenger-app. Eén deploybaar artefact matcht die realiteit precies. Meerdere repo's die samen naar één proces deployen voegen integratiecomplexiteit toe zonder winst zolang er één app is.

**Evolutie.** Structureer *binnen* de repo nu al harde modulegrenzen: een **domeinkern** (rekenregels, autoritatieve stemlogica — conform ADR-0003's "stem-submodule"-gedachte), een **beheer**-interface, een **deelnemer**-interface en een **data-adapter**. Dat is 80% van de winst van modules zónder de kosten van polyrepo. Extraheer een module pas naar een eigen repo als hij (a) een stabiel, gepubliceerd contract heeft, (b) een eigen release-cadans nodig heeft, én (c) meer dan één consument bedient. De domeinkern is de eerste kandidaat (later gedeeld tussen fase-1-beheerapp en fase-2-portaal). Extractie doe je dan schoon via `git subtree`/submodule.

**Modules in modules, aan/uit te zetten (richting vermarkting).** Bas' beeld is niet één platte laag modules maar geneste, **schakelbare** modules — met het oog op later het product echt vermarkten. Dat versterkt bovenstaand advies in plaats van het te weerspreken: schakelbaarheid vraagt om een expliciet **contract per module** (een duidelijke in-/uitgang) en een **feature-registry** die een module aan- of uitzet zonder de rest te raken. Precies dat dwing je het goedkoopst af binnen één repo met harde interne grenzen: je test elke combinatie van aan/uit in één CI, en je pint per module een versie. Concreet ontwerpprincipe voor Codex: elke module krijgt (1) een smal, versiebaar contract, (2) een aan/uit-vlag in een centrale registry, en (3) geen directe import over modulegrenzen heen — alleen via het contract. Zo is een module later los te verkopen/extraheren zonder herbouw. De repo-splitsing volgt de commerciële naad pas wanneer een module een eigen klant/afnemer én eigen release-cadans heeft (de extractie-trigger hierboven).

Kortom: je "later naar modules" en "aan/uit-schakelbaar richting vermarkting" respecteren door contracten en een feature-registry nu in code te trekken, maar de repo-splitsing pas te betalen wanneer de naden — technisch én commercieel — bewezen zijn. Dat dient stabiliteit, veiligheid én deployment tegelijk.

---

## 9. Versiebeheer

Conform `vX.y.z` (X major/nieuwe functionaliteit·layout·architectuur, y minor/next-step, z patch/bugfix·typo). Versie in de **documentbestandsnaam**; in code via `package.json` + git-tag, niet in elke bronbestandsnaam (dat zou referenties breken — jouw voorkeur). ADR's zijn genummerd en onveranderlijk; een gewijzigd besluit krijgt een nieuwe ADR die de oude "supersedes". Dit document is **v1.0.0** (eerste volledige OTAP-opzet). De app-code start op `v0.1.0` zodra Codex fase-1-code van het portaal oplevert.

---

## 10. Eerste stappen — status 10 aug 2026

1. **[loopt — Bas] Mistral lokaal.** Volg `Mistral_Lokaal_setup_runbook_v1.0.0.md`. Model gepind: **Mistral-Nemo 12B (Q4) via Ollama** (RTX 4070, 12 GB VRAM). Kritieke afhankelijkheid voor testdata en de PII-gate.
2. **[geleverd — Codex-instructie klaar] T-run + CI-gates.** Zie `docs/gates/Codex-taak-10.2_T-run-en-CI-gates.md`: `loadtest`-profiel als expliciete **T**-run + arch-regel-checks + PII-scan-hook (ADR-0002, ADR-0005). Codex kan starten.
3. **[in de wacht tot Mistral draait] A-domein.** Zodra Mistral werkt, schrijf ik de instructie voor Codex+Mistral om `acceptatie.honigfabriek.nl` op te zetten (eigen database, eigen application root) en `scripts/deploy.sh` richting A werkend te maken.
4. **[loopt — Claude] Acceptatiecriteria.** Toegangscode-entropie/rate limiting (§6) en PII-scheiding (§7) als ADR's/gates, zodat Gemini erop kan testen.
5. **[besloten — ADR-0006] Bewaartermijnen + stemprocedure.** Vastgelegd door Bas: stem-door-appartementsrecht, 7 jaar ALV-resultaat, persoonsdata ownership +2 jaar, vaststelling door voorzitter. Eén juridisch punt staat nog open (ADR-0006 §Open punt).

Extra besloten deze ronde: `stem.honigfabriek.nl` → onderhoudspagina (`Platform/stem_onderhoudspagina/index.html`), `stem-dev` gearchiveerd, live = `portaal.honigfabriek.nl`, acceptatie = `acceptatie.honigfabriek.nl`.

---

*Zie ook: `docs/ADR/ADR-0004-otap-topologie-en-testdata.md`, `docs/ADR/ADR-0005-pii-buiten-release-en-provisioning.md`, `docs/ADR/ADR-0006-bewaartermijnen-en-stemprocedure.md`, `docs/Mistral_Lokaal_setup_runbook_v1.0.0.md`, `docs/gates/Codex-taak-10.2_T-run-en-CI-gates.md`.*
