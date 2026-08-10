# Architectuur- en infravoorstel — digitaal ALV-eigenaarportaal — v0.2.0

**Datum:** 6 augustus 2026
**Rol auteur:** Claude — Architect & Validator
**Status:** voorstel ter beoordeling door Bas; bouwt voort op `Eerste_opzet_digitale_ALV_eigenaarportaal_v0.1.0`
**Besluit vooraf (Bas, 6 aug 2026):** Docker uitsluitend voor dev/test/CI; productie blijft mijn.host `.starter`. Projectroot: `D:\Bas_en_AIs\Platform\ALV_Digitaal`.

---

## 1. Managementsamenvatting

v0.1.0 is een sterk en volwassen ontwerp: scope, privacy, het vier-AI-gatemodel en de Definition of Done zijn scherp. Ik onderschrijf de kernkeuzes (server-side stemverwerking in MySQL, geen permanente WebSockets, mobiele webapp zonder verplichte PWA, atomair sluiten). Dit voorstel voegt drie dingen toe die v0.1.0 nog niet had: (1) een reproduceerbare **dev/test/CI-omgeving in Docker met productie-pariteit**, (2) een concrete **beoordeling met risico's en gaps** vanuit de architectrol, en (3) een **infra-scaffold** die vandaag te starten is.

De belangrijkste architectonische spanning is opgelost: de productie draait op shared hosting zónder Docker, maar de vier AI's ontwikkelen en testen op een **container die het productieplatform nabootst** (dezelfde database-engine, dezelfde Node-versie, één enkel app-proces achter een reverse proxy). Docker is hier een ontwikkel- en testinstrument, geen productie-runtime. Zo krijgen we reproduceerbaarheid en een eerlijke 120-clients-belastingstest, zonder de scope, kosten of AVG-verantwoordelijkheid van een VPS binnen te halen.

---

## 2. Beoordeling van v0.1.0

### 2.1 Wat sterk is en blijft

Het ontwerp vermijdt de klassieke valkuil van "bouw een tweede stemsysteem": de bestaande, gevalideerde ALV-rekenregels blijven leidend en worden eerst met regressietests vastgepind vóór er iets omheen wordt gebouwd. Dat is de juiste volgorde. Het polling-model met willekeurige spreiding en `ETag`/versienummer is precies passend bij shared hosting: geen permanente verbindingen, weinig gelijktijdige entry processes, lage overdracht. De scheiding tussen `Present` (juridische registratie) en `Laatst gezien` (technische indicator) is juridisch verstandig. Het append-only `vote_revision`-model met "laatste geaccepteerde revisie telt" en atomair sluiten in één transactie is de correcte manier om race-condities en dubbeltellingen uit te sluiten. De privacyparagraaf (gehashte credentials, één actief apparaat, same-origin, HttpOnly/Secure cookies, synthetische testdata) is compleet op hoofdlijnen.

### 2.2 Risico's en gaps die aandacht vragen

De volgende punten zijn geen fouten in v0.1.0, maar zaken die het ontwerp nog niet vastlegt en die vóór de bouw of vóór livegang beslist moeten worden.

**Database-engine-pariteit.** v0.1.0 zegt "MySQL", maar mijn.host levert vrijwel zeker **MariaDB**, geen Oracle MySQL 8. Dialectverschillen (JSON-functies, `utf8mb4`-collations, `FOR UPDATE`-gedrag, standaard sql_mode) kunnen tussen lokaal en productie stil afwijken. De dev/test-container moet dezelfde engine en major-versie draaien als `.starter`. Dit is verplicht te verifiëren bij support (zie vraag 6, v0.1.0) en vast te leggen in een ADR.

**Eén-proces-realiteit op shared hosting.** CloudLinux beperkt entry processes en procesduur. Het ontwerp mag daarom nergens leunen op in-memory state die een tweede proces of een clustering veronderstelt: sessies, rondestatus en presentie moeten volledig in MySQL leven. v0.1.0 doet dit al impliciet ("herstelbare serversessie"), maar het moet een expliciete architectuurregel worden: **geen state buiten MySQL, behalve een korte read-cache met ETag.**

**Correct client-IP achter LiteSpeed.** Rate limiting en de "één actief apparaat"-logica hebben het echte IP nodig. Op shared hosting zit LiteSpeed ervoor; de app moet `X-Forwarded-For` correct en veilig interpreteren (alleen vertrouwen wat van de eigen proxy komt). Dit hoort in de dev-omgeving met een reverse proxy nagebootst te worden, anders test Gemini rate limiting die in productie anders werkt.

**Bewaartermijnen en verwerkingsregister ontbreken concreet.** Mistral bewaakt bewaartermijnen, maar er is nog geen vastgelegd schema (hoe lang blijven credentials, sessies, audit-events, exports bewaard?). Voor de AVG is een korte DPIA/verwerkingsregister-notitie wenselijk omdat er stemgedrag van geïdentificeerde eigenaren wordt verwerkt. Dit is een **menselijke/juridische taak** — geen AI beslist dit — maar de architectuur moet velden en retentie-hooks voorbereiden. Voorstel: retentietabel in een ADR, technische opschoning via een script.

**Secrets op shared hosting.** `.env` mag niet in Git, maar waar leven de productiegeheimen dan wél op `.starter`? Opties: DirectAdmin-omgevingsvariabelen of een configbestand buiten de webroot met strakke rechten. Vast te leggen vóór Fase 4.

**Tijdsbron voor audit.** Alle audit-tijdstempels moeten van de **servertijd** komen (nooit client), in UTC opgeslagen. Triviaal, maar expliciet maken voorkomt discussie over stemtijdstippen.

**Back-up is niet hetzelfde als herstelbaarheid.** mijn.host maakt dagelijkse back-ups, maar de release moet een **eigen, geteste export- en herstelprocedure** hebben (v0.1.0 Fase 4 noemt dit; ik markeer het als harde gate: een herstel dat niet geoefend is, bestaat niet).

### 2.3 Aanbevolen kleine scope-verfijningen

Ik stel voor twee dingen expliciet buiten versie 1 te bevestigen die nu impliciet zijn: geen realtime dashboards voor toeschouwers, en geen e-mailverzending vanuit de app zelf (uitnodigingen/links gaan via het bestaande beheerproces). Dat houdt het aanvalsoppervlak en de entry-processdruk laag.

---

## 3. Doelarchitectuur (productie)

Ongewijzigd t.o.v. v0.1.0 op hoofdlijnen: één Node.js-app op mijn.host `.starter`, twee afgescheiden interfaces (`/beheer`, `/deelnemen`), MySQL/MariaDB als enige state, polling met jitter, atomair sluiten in één transactie. De aanvulling is dat ik de **architectuurregels** die shared hosting oplegt expliciet vastleg:

1. Alle state in MySQL/MariaDB; het Node-proces is staatloos herstartbaar.
2. Geen permanente verbindingen (WS/SSE) in versie 1; polling met ETag.
3. Elke schrijfhandeling die de uitslag raakt loopt via een InnoDB-transactie met `SELECT ... FOR UPDATE` op de ronde.
4. Eigenaars-API's leveren uitsluitend gegevens van de ingelogde eigenaarsgroep (row-level filtering, geen client-side filtering).
5. Servertijd (UTC) is de enige bron voor audit-tijdstempels.
6. Rate limiting en apparaatbinding gebruiken het geverifieerde client-IP via de proxyheader.

Deze zes regels worden ADR-0002 en zijn de meetlat waartegen ik (Architect & Validator) implementaties toets.

---

## 4. Dev/test/CI-omgeving in Docker (de kern van dit voorstel)

### 4.1 Uitgangspunt: pariteit, niet gemak

De container bestaat om productie na te bootsen, niet om het makkelijker te maken dan productie. Concreet betekent dat: dezelfde database-engine en major-versie als `.starter`, de Node-versie die mijn.host aanbiedt, één enkel app-proces (geen `cluster`, geen PM2-fork-mode) en een reverse proxy ervoor die `X-Forwarded-For` zet zoals LiteSpeed dat doet. Als de app lokaal correct werkt onder deze beperkingen, is de kans groot dat hij dat op `.starter` ook doet.

### 4.2 Compose-services

```text
alv-app      Node.js-app (single process), de productcode van Codex
alv-db       MariaDB (versie = mijn.host, te bevestigen; default nu 10.11 LTS)
alv-proxy    Caddy of nginx als reverse proxy; zet X-Forwarded-For, TLS lokaal
alv-adminer  Adminer, alleen in het dev-profiel, voor DB-inspectie
alv-loadtest k6, alleen in het loadtest-profiel, simuleert 120+ clients
```

`alv-adminer` en `alv-loadtest` zitten achter Docker Compose **profielen** (`--profile dev`, `--profile loadtest`) zodat ze niet meedraaien in een normale run en de basisrun net zo licht blijft als productie. De app draait bewust met een geheugenlimiet die 2 GB RAM van `.starter` benadert, zodat een geheugenlek lokaal net zo hard opvalt als in productie.

### 4.3 Wat dit oplevert per rol

Voor **Codex (Lead Developer)**: `docker compose up` geeft een identieke omgeving op elke machine; migraties draaien tegen dezelfde engine als productie. Voor **Gemini (Lead Tester)**: het `loadtest`-profiel draait de 120-clients-stemburst reproduceerbaar en op commando, met synthetische data; de proxy maakt dat rate-limiting- en apparaatbinding-tests representatief zijn. Voor **Mistral (Integrator & AVG-gatekeeper)**: een CI-stap kan de container opspinnen, de test-fixtures scannen op echte persoonsgegevens en de release-zip bouwen uit exact wat getest is. Voor **mij (Architect & Validator)**: ik kan de zes architectuurregels uit §3 als geautomatiseerde checks in CI hangen (bijv. een test die faalt als state buiten MySQL wordt gedetecteerd of als een uitslag zonder transactie wordt weggeschreven).

### 4.4 Belangrijk: de container gaat niet mee naar productie

De productie-deploy is géén `docker push`. Het is de bestaande shared-hostingroute: broncode via SSH/rsync naar `.starter`, `npm install --production` via SSH, Node-app (her)starten via DirectAdmin. De Dockerfile en compose zijn ontwikkel- en CI-gereedschap. Een deploy-script (`scripts/deploy.sh`, voorzet meegeleverd) documenteert deze stappen zodat ze herhaalbaar en controleerbaar zijn — dit is de plek waar Mistral de release-gate afdwingt.

---

## 5. Versiebeheer

Conform jouw conventie `vX.y.z`:

- **X** — major: nieuwe functionaliteit, nieuwe layouts, architectuurwijziging.
- **y** — minor: kleine fixes, next-step-progressie.
- **z** — patch: bugfixes, typo's, kleine layoutaanpassingen.

Dit document is `v0.2.0` (minor-progressie op v0.1.0: architectuur verdiept + infra toegevoegd, nog geen productcode). De app zelf start op `v0.1.0` zodra Fase 1-code bestaat. Versie in de bestandsnaam van documenten; in code via `package.json` + een git-tag, niet in elke bronbestandsnaam (dat zou referenties breken — conform jouw voorkeur). ADR's zijn genummerd en onveranderlijk; een besluit dat verandert krijgt een nieuwe ADR die de oude "supersedes".

---

## 6. Fasering (aangepast op v0.1.0)

De fasering van v0.1.0 blijft staan; ik voeg een **Fase 0.5** toe tussen de hostingspike en de domeinkern: het opzetten van de Docker-dev/test-omgeving en de CI-gates. Dit is 1–2 dagen en betaalt zich terug omdat alle latere fasen erop leunen.

| Fase | Inhoud | Duur | Eigenaar-rol |
|---|---|---|---|
| 0 | Hosting-spike + supportvragen mijn.host | 2–3 d | Codex + Claude |
| 0.5 | **Docker dev/test/CI-omgeving + gate-automatisering** | 1–2 d | Codex + Mistral |
| 1 | Domeinkern isoleren + regressietests | 4–6 d | Codex, valideert Claude |
| 2 | Toegang, credentials, presentie, sessies | 5–7 d | Codex, test Gemini |
| 3 | Digitale stemronde + atomair sluiten | 6–8 d | Codex, valideert Claude |
| 4 | Beveiliging, audit, export, fallback | 4–6 d | Codex + Mistral |
| 5 | Onafhankelijke QA + twee proefvergaderingen | 5–8 d | Gemini |

Doorlooptijd blijft **6–8 kalenderweken** bij deels parallel werken; **8 weken + minimaal 2 weken marge vóór de echte ALV** blijft de veilige doelstelling.

---

## 7. Gate- en handoffproces (bevestigd, met CI-hook)

Het handoffproces uit v0.1.0 §10 neem ik ongewijzigd over. Toevoeging: elke handoff wordt vastgelegd via het `docs/gates/handoff-template.md` en waar mogelijk **geautomatiseerd afgedwongen** in CI. Concreet: Codex kan pas mergen als (a) regressietests groen zijn, (b) de architectuurregel-checks van Claude slagen, en (c) Mistrals persoonsgegevens-scan op de diff en fixtures schoon is. Gemini's belastingstest en Claude's domeinvalidatie zijn handmatige gates met vastgelegd bewijs. Bas houdt het finale go/no-go.

Kernregel blijft: geen twee AI's wijzigen gelijktijdig hetzelfde bronbestand; productcode loopt via Codex, integratie via Mistral.

---

## 8. Open te verifiëren vóór de bouw

1. **MariaDB-versie op `.starter`** (bepaalt de `alv-db`-image; vraag 6 aan support).
2. **Node-versie** die mijn.host aanbiedt (bepaalt de Dockerfile-base-image).
3. De acht supportvragen uit v0.1.0 §13 (entry processes, MySQL-connecties, WS/SSE, cold start, CloudLinux-limieten).
4. **Bewaartermijnen + DPIA-notitie** — menselijke/juridische input van Bas.
5. **Secrets-locatie op productie** (DirectAdmin-env vs. configbestand buiten webroot).

Deze vijf punten zijn geen aannames in het ontwerp; ze zijn beslispoorten. De Docker-images pinnen we pas definitief zodra punt 1 en 2 beantwoord zijn — tot die tijd staat er een verantwoorde default (MariaDB 10.11 LTS, Node 20 LTS) in de scaffold, duidelijk gemarkeerd als "te bevestigen".

---

## 9. Voorgestelde eerste stappen

Zodra je akkoord bent: Codex stelt de acht supportvragen en zet Fase 0 in gang; parallel maakt hij de Docker-omgeving uit de meegeleverde scaffold werkend en pinnen we de versies zodra support antwoordt. Ik (Claude) schrijf de acceptatiecriteria voor quorum, PG-blok, machtigingen en stemrondes als eerste ADR's, zodat Gemini daar zijn tests op kan baseren. Mistral zet de persoonsgegevens-scan en de release-gate op in CI. Jij levert de bewaartermijnen en de juridische lijn voor oproeping en digitale vergaderprocedure.

---

*Bijlagen in deze repo: `infra/` (docker-compose, Dockerfile, MariaDB-init, loadtest), `docs/ADR/` (besluitregister), `docs/gates/handoff-template.md`, `scripts/deploy.sh`. Zie `README.md` voor het opstarten.*
