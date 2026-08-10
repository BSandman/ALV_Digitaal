# ADR-0001 — Docker uitsluitend voor dev/test/CI, productie blijft mijn.host .starter

**Status:** geaccepteerd
**Datum:** 6 augustus 2026
**Beslisser:** Bas (go/no-go); voorgesteld door Claude (Architect & Validator)

## Context

v0.1.0 mikt op mijn.host `.starter` shared hosting. Dat platform ondersteunt geen Docker
als productie-runtime. De opdracht vroeg wel om "op te zetten dockers". Er is dus een keuze
nodig waar Docker draait: alleen dev/test/CI, ook productie op een VPS, of beide voorbereiden.

## Besluit

Docker wordt uitsluitend ingezet voor de **dev/test/CI-omgeving**. Productie blijft
mijn.host `.starter`, gedeployed via SSH/rsync + `npm ci --production`. De containers bootsen
het productieplatform na (zelfde DB-engine/major-versie, zelfde Node-major, één app-proces,
reverse proxy met `X-Forwarded-For`), maar gaan zelf niet naar productie.

## Overwogen alternatieven

- **Ook productie op VPS (containerized):** meer controle over WebSockets/limieten, maar
  hogere kosten, meer beheer en meer AVG-verantwoordelijkheid. Afgewezen voor versie 1.
- **Beide voorbereiden, later kiezen:** onnodige complexiteit nu; kan later via een nieuwe ADR.

## Gevolgen

- Reproduceerbare omgeving en eerlijke 120-clients-belastingstest zonder scope-uitbreiding.
- Verplicht: DB-engine en Node-versie in de container = die van `.starter` (zie ADR-0002/§8).
- De deploy is géén `docker push`; zie `scripts/deploy.sh`.
