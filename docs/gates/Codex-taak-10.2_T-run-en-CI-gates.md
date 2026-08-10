# Codex-taak 10.2 — Test-omgeving (T) als expliciete run + CI-gates

**Opdrachtgever:** Claude (Architect & Validator), namens Bas
**Uitvoerder:** Codex (Lead Developer)
**Datum:** 10 augustus 2026
**Referenties:** `OTAP_opzet_v1.0.0.md` §3–§4, ADR-0002, ADR-0004, ADR-0005
**Werkmap:** `D:\Bas_en_AIs\VvE_Werk\Platform\ALV_Digitaal`

> Lever op via het handoff-template (`docs/gates/handoff-template.md`). Werk op een branch, niet op `main`. Raak geen bronbestand aan dat een andere rol op dat moment bewerkt.

## Doel

Maak de **T-trap** uit de OTAP-opzet concreet en herhaalbaar, en veranker de poort T→A als geautomatiseerde CI-gates. O en T draaien op hetzelfde Docker-compose; T = de basisrun + de profielen `dev` en `loadtest`. Er wordt in deze taak **geen productcode-functionaliteit** gebouwd; dit is infrastructuur en gating.

## Op te leveren

### 1. T-run als één commando

- Zorg dat `docker compose --profile dev --profile loadtest up` een reproduceerbare T-omgeving geeft: app (single process), MariaDB **11.8.8**, reverse proxy die `X-Forwarded-For` zet (LiteSpeed-pariteit), Adminer (dev-profiel), k6 (loadtest-profiel).
- De app draait met een geheugenlimiet die 2 GB RAM van `.starter` benadert (ADR-0002-realiteit).
- Documenteer het commando in `README.md` onder "Snel starten (test)".

### 2. Synthetische testdata in T (koppelvlak met Mistral)

- T gebruikt **uitsluitend synthetische data** (ADR-0004). Lees de dataset uit `mistral-lokaal/out/synthetic/owners.synthetic.json` (door Mistral geleverd) en laad die in de T-database via de bestaande `mysql/init/`-seedroute.
- Als de Mistral-dataset nog niet bestaat, val terug op een ingecheckte, duidelijk fictieve mini-seed. **Nooit** echte data in T of in de repo.
- Houd het productieschema en de synthetische set veldgelijk, zodat een test op synthetisch 1-op-1 naar productie vertaalt.

### 3. CI-gate A — architectuurregels (ADR-0002)

Voeg geautomatiseerde checks toe die falen (exitcode ≠ 0) bij overtreding van de zes regels, minimaal:

- state buiten de database gedetecteerd (in-memory sessie/rondestatus/presentie) → faal;
- een uitslag-rakende schrijfhandeling zonder transactie/`SELECT ... FOR UPDATE` → faal;
- gebruik van client-tijd i.p.v. servertijd-UTC voor audit → faal;
- eigenaars-endpoint zonder server-side row-level filtering → faal.

Waar een statische check niet kan, schrijf een integratietest tegen de draaiende T-omgeving.

### 4. CI-gate B — PII-scan-hook (ADR-0005)

- Voeg een blokkerende PII-scanstap toe die draait op (a) de git-diff, (b) de fixtures en (c) de inhoud van het gebouwde release-artefact.
- De scan is **primair deterministisch** (patronen: e-mailadressen, bestandsnamen `owners.js`/`owners.initial.js`/`events.json`/`audit.log`/`cycle.json`/snapshots, bekende echte VvE-namen/straten). Exitcode ≠ 0 = build faalt.
- Bouw dit als een aanroepbaar script (`mistral-lokaal/scripts/pii_scan`) zodat Mistral de LLM-tweede-beoordeling er later aan kan hangen; de deterministische kern moet zelfstandig werken zonder model.
- Acceptatie van deze gate: een testartefact met een `owners.initial.js` erin **moet** de build laten falen (regressietest op het fase-1-lek).

### 5. Release-artefact = alleen code

- De buildoutput bevat **nooit** `owners.*`, `events.json`, `audit.log`, `cycle.json`, snapshots of runtime-data (ADR-0005).
- Versie via `package.json` + git-tag (`vX.y.z`), niet in bronbestandsnamen.

## Definition of done

- `docker compose --profile dev --profile loadtest up` levert een werkende T-omgeving met synthetische data.
- Gate A en Gate B draaien in CI en falen aantoonbaar op een geprepareerde overtreding (lever het rode + groene bewijs).
- De 120-clients-burst van Gemini kan tegen deze T draaien (koppelpunt, niet zelf uitvoeren).
- Handoff ingevuld, met testbewijs (§3 template) en privacyclassificatie (§4 template) = schoon.

## Buiten scope (expliciet)

- Het opzetten van het A-domein op mijn.host (dat is taak 10.3, samen met Mistral, later).
- Productcode/domeinfunctionaliteit (aparte fasen 1–3 uit v0.2.0 §6).
- De pseudonimisering voor A (Mistral, taak 10.3).
