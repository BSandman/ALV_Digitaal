# ADR-0003 — Databasekeuze: SQLite (fast-track) vs. MariaDB (Platform)

**Status:** geaccepteerd — engine bevestigd op de echte server (6 aug 2026)
**Datum:** 6 augustus 2026
**Beslisser:** Bas; voorgesteld door Claude (Architect & Validator)
**Context-links:** [[ADR-0001]] (Docker alleen dev/test), [[ADR-0002]] (shared-hosting-regels)

## Context

Twee doelen botsen. (1) Deze stem-app fast-tracken en snel live op mijn.host `.starter`.
(2) Later integreren als **stem-submodule** in het bredere "Platform" voor VvE Beheer
(de functie die de bestaande app 1.9.1 nu biedt), waarvoor Bas naar **MariaDB** neigt.
De vraag: SQLite voor snelheid nu, of meteen MariaDB?

## Bevindingen over de mijn.host-infra (bron: mijn.host KB + webhostingpagina, 6 aug 2026)

- **Node.js-versie:** mijn.host adviseert **versie 19 of 20** via de DirectAdmin "Setup Node.js
  App". Node 22+ is niet de aanbevolen route → de ingebouwde `node:sqlite` is hier **niet
  beschikbaar**. SQLite zou dus `better-sqlite3` vergen: een **native module die op de host
  gecompileerd moet worden** (node-gyp) binnen de CloudLinux Node-virtualenv.
- **Node-runtime:** DirectAdmin/CloudLinux Node Selector draait achter **Phusion Passenger**.
  Passenger kan meerdere worker-processen spawnen en de app bij inactiviteit stoppen/cold-starten.
  Gevolg: geen in-memory state (bevestigt ADR-0002), én bij SQLite meerdere processen die naar
  één bestand schrijven → verplicht WAL-modus + `busy_timeout`.
- **Opslag:** volledig **lokaal NVMe**, per account in een **geïsoleerde CloudLinux-container**.
  Dat is gunstig voor SQLite-bestandslocking (geen NFS), **mits** support bevestigt dat de
  app-map lokale schijf is en geen netwerkmount.
- **Database (BEVESTIGD via serverpaneel):** **MariaDB 11.8.8** (`11.8.8-MariaDB-cll-lve`),
  bereikbaar via **lokale UNIX-socket** (`/var/lib/mysql/mysql.sock`) — dus lokaal, geen
  netwerkmount. Databases zitten kant-en-klaar (3 op `.starter`), 1 klik in DirectAdmin; losse
  database terugzetten kan vanuit het controlepaneel.
- **Productie-`sql_mode` (BEVESTIGD):** `ERROR_FOR_DIVISION_BY_ZERO, NO_AUTO_CREATE_USER,
  NO_ENGINE_SUBSTITUTION` — dus **niet strict**. Risico: de server accepteert/kapt slechte data
  stil af. Mitigatie: de app zet **per verbinding** een vaste strict `sql_mode`
  (`STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION`), zodat dev en productie identiek gedragen
  ongeacht de serverdefault. Vastgelegd in de Docker-scaffold (`DB_SESSION_SQL_MODE`).
- **Redis** is aanwezig (caching), maar niet als autoritatieve opslag voor stemdata te gebruiken.

## Kernanalyse

Het gebruikelijke fast-track-argument voor SQLite ("geen databaseserver op te zetten") **geldt
hier nauwelijks**: mijn.host levert MySQL/MariaDB turnkey, terwijl SQLite juist een native
`better-sqlite3`-build op Node 20 en multi-proces-zorg (WAL/locking) toevoegt. Op dit platform
kost SQLite dus eerder **meer** deploy-inspanning, niet minder.

Daar bovenop: het einddoel is integratie in een **MariaDB-Platform**. SQLite nu betekent later
een schema- en **datamigratie SQLite → MariaDB** — precies op de stemdata die aantoonbaar
correct moet blijven. Extra werk en extra risico op de gevoeligste tabel.

## Besluit (voorgesteld)

**MariaDB/MySQL nu, met een dunne, verwisselbare data-toegangslaag (repository-patroon).**
Zo halen we beide doelen: turnkey en snel op `.starter` (fast-track), dezelfde engine als het
Platform (schone integratie, geen stemdata-migratie), en de engine blijft in theorie
verwisselbaar. In de dev/test-container draait MariaDB voor pariteit (ADR-0001).

SQLite blijft een gedocumenteerde optie **uitsluitend** als een Fase-0-spike aantoont dat het
netto sneller/eenvoudiger is. Met de engine nu bevestigd (MariaDB 11.8.8, lokale socket,
turnkey) is dat argument verder verzwakt: MariaDB is de pragmatische én strategische keuze.

## Overwogen alternatieven

- **SQLite (`better-sqlite3`) nu, migreren later:** technisch prima op deze schaal
  (120 users, ~20 writes/s), single-writer-slot helpt zelfs bij atomair sluiten. Afgewezen als
  default omdat het hier geen deploy-tijd wint en een latere stemdata-migratie oplevert.
- **`node:sqlite`:** niet beschikbaar op de aanbevolen Node 19/20; bovendien pas RC-stabiliteit.
- **Redis als store:** ongeschikt als autoritatieve/juridische stemopslag.

## Gevolgen

- Codex bouwt achter een repository-interface (bv. `VoteStore`, `MeetingStore`), niet met
  directe SQL-calls door de codebase heen. Verwisselen van engine raakt dan één laag.
- Fase 0 stelt aan support nog: hoeveel Passenger-processen per app, en idle-stop/cold-start-
  gedrag (vult v0.1.0 §13 aan). Engine/versie en DB-locality zijn nu al bevestigd.
- De Docker-scaffold is gepind op **mariadb:11.8** (matcht productie 11.8.8).
