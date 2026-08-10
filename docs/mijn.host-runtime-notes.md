# mijn.host runtime-notities — Node-proces, idle & cold start

**Datum:** 6 augustus 2026
**Auteur:** Claude (Architect & Validator)
**Doel:** vastleggen hoe `.starter` een Node-app draait, wat dat betekent voor de ALV, en
welke mitigaties en supportvragen resteren. Vult v0.1.0 §13 en ADR-0002 aan.

## Hoe `.starter` een Node-app draait

- **Beheer via CloudLinux Node.js Selector** (DirectAdmin → "Setup Node.js App"), met een
  **virtualenv per app**. Aanbevolen Node **19/20**.
- **Webserver = LiteSpeed Enterprise** (niet Apache). LiteSpeed serveert de Node-app zelf;
  op cPanel/Apache-hosts doet Phusion Passenger dit. De mechanismen zijn vergelijkbaar:
  de app draait als een **beheerd, los proces** dat **op aanvraag start** en **na inactiviteit
  wordt gestopt**.
- **CloudLinux LVE** begrenst het account op o.a. **Entry Processes (EP)** en **NPROC**.
  EP = gelijktijdige "ingangen" (in-flight requests); default-plafonds liggen vaak rond 200,
  maar zijn **host-specifiek en niet publiek door mijn.host gepubliceerd**.

## Wat dit betekent voor de ALV — en de mitigaties

**Cold start / idle — in de praktijk GEEN probleem (besluit Bas, 6 aug 2026).** De bestaande
`stem.honigfabriek.nl` draait al op Node.js en vertoont **geen idle-timeout over 24u+**; het
proces blijft staan. Bovendien activeert Bas het platform sowieso vóór de vergadering, dus een
eerste-bezoeker-cold-start speelt niet.
→ **Besluit:** **geen keepalive-cronjob nodig.** `scripts/keepalive.sh` blijft als optionele
fallback staan maar wordt niet ingezet. Supportvragen 2 en 5 hieronder vervallen daarmee
feitelijk (alleen nog relevant als er ooit ander gedrag opduikt).

**EP-throttling onder 120 pollers.** Node bedient veel gebruikers via één event loop, maar
CloudLinux telt EP's op basis van in-flight requests. Door de **jittered polling** (3–6 s met
spreiding, v0.1.0 §6) en **korte responses** zijn er op elk moment maar een handvol gelijktijdige
requests — ruim onder een EP-plafond van ~200. De **stemburst** is de piek.
→ **Mitigatie + bewijs:** de k6-belastingstest (`infra/loadtest/vote-burst.js`) meet dit; als
`Resource Usage` EP-limieten raakt → upgrade naar Basic (v0.1.0 §12).

**Meerdere app-processen.** Als de host >1 Node-proces voor de app start, is dat correctheids-
technisch geen probleem (alle state in MariaDB, ADR-0002), maar elk proces opent een eigen
DB-pool. Daarom staat de pool bewust klein (`DB_POOL_SIZE=5`) i.v.m. het MySQL-verbindingslimiet.
→ **Afhankelijk van** het antwoord op de supportvraag hieronder.

## Resterende supportvragen (specifiek, meetbaar)

1. Hoeveel **gelijktijdige Node-processen** start LiteSpeed voor één app op `.starter`
   (vast 1, of dynamisch geschaald)? Is dit instelbaar?
2. Wat is de **idle timeout** waarna het Node-proces wordt gestopt, en de **cold-start**-tijd?
3. Wat is het **EP-plafond** en het **NPROC**-plafond voor dit account (CloudLinux LVE)?
4. Wat is het **maximum aantal gelijktijdige MySQL-verbindingen** per account (bepaalt poolgrootte)?
5. Is een **keepalive-cron** toegestaan om het proces warm te houden, of botst dat met beleid?

## Zelf meten in Fase 0 (niet wachten op support)

- Idle/cold start: app starten, 10–30 min niets doen, dan één request → tijd meten; herhalen.
- EP/geheugen: k6-loadtest draaien terwijl `Resource Usage` in DirectAdmin wordt gevolgd.
- Procesaantal: via SSH `ps` tijdens belasting kijken hoeveel Node-processen leven.

## Conclusie voor het ontwerp

Geen van deze punten wijzigt de architectuur; ze bepalen **tuning** (poolgrootte, keepalive,
en de Starter-vs-Basic beslispoort). De keuzes uit ADR-0002 (alle state in MariaDB, staatloos
herstartbaar) maken de app juist ongevoelig voor cold starts en procesherstarts.
