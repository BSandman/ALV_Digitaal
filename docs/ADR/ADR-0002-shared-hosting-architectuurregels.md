# ADR-0002 — Architectuurregels opgelegd door shared hosting

**Status:** geaccepteerd
**Datum:** 6 augustus 2026
**Beslisser:** Claude (Architect & Validator); bevestigd door Bas

## Context

`.starter` is shared hosting met CloudLinux-limieten op entry processes en procesduur, en
één Node-proces zonder clustering. De architectuur mag hier nergens op leunen die deze
beperkingen negeert. Deze regels zijn de meetlat waartegen implementaties worden gevalideerd.

## Besluit — zes regels

1. Alle state in MySQL/MariaDB; het Node-proces is staatloos herstartbaar.
2. Geen permanente verbindingen (WS/SSE) in versie 1; polling met ETag en jitter.
3. Elke uitslag-rakende schrijfhandeling loopt via een InnoDB-transactie met `SELECT ... FOR UPDATE` op de ronde.
4. Eigenaars-API's leveren uitsluitend gegevens van de ingelogde eigenaarsgroep (row-level, server-side).
5. Servertijd (UTC) is de enige bron voor audit-tijdstempels.
6. Rate limiting en apparaatbinding gebruiken het geverifieerde client-IP via de proxyheader.

## Gevolgen

- Sessie, presentie en rondestatus mogen niet in in-memory variabelen leven.
- Deze regels worden waar mogelijk als geautomatiseerde CI-checks afgedwongen (voorstel §4.3).
- Afwijking vereist een nieuwe ADR die dit besluit "supersedes".
