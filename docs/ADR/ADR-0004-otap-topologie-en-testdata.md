# ADR-0004 — OTAP-topologie en testdatastrategie

**Status:** geaccepteerd
**Datum:** 10 augustus 2026
**Beslisser:** Bas; voorgesteld door Claude (Architect & Validator)
**Context-links:** [[ADR-0001]] (Docker alleen dev/test), [[ADR-0002]] (shared-hosting-regels), [[ADR-0003]] (databasekeuze), [[ADR-0005]] (PII buiten release)

## Context

v0.2.0 legde twee omgevingen vast: Docker-dev/test/CI lokaal en productie op mijn.host `.starter`. Dat is feitelijk O+T lokaal en P op de hosting, met een gat: er was geen aparte **Acceptatie** op het echte platform vóór livegang. Platformfouten (Passenger cold start, MariaDB-`sql_mode`, `X-Forwarded-For`, entry-processlimieten) laten zich niet lokaal aantonen. Tegelijk mag echte eigenaars-PII niet zomaar rondreizen door test- en CI-omgevingen (AVG).

## Besluit

**Topologie:** vier trappen, promotie strikt één richting O → T → A → P.

- **O — Ontwikkeling:** lokaal, Docker Compose basisrun. Codex.
- **T — Test:** lokaal, Docker Compose met `dev`- en `loadtest`-profiel. Gemini + CI-gates.
- **A — Acceptatie:** mijn.host `.starter`, eigen subdomein en eigen database, gescheiden van P. Generale repetitie + UAT/proefvergadering.
- **P — Productie:** mijn.host `.starter`, eigen subdomein en eigen database. Echte ALV.

**Testdata:**

- **T = volledig synthetisch.** Mistral genereert fictieve eigenaars met realistische structuur (huisnummer+toevoeging, breukdelen, stemgewicht, ondersplitsingen, meerdere rechten), zonder relatie tot echte personen. Geen echte PII in T of CI.
- **A = gepseudonimiseerd.** Mistral leidt uit de echte lijst een set af met behoud van structuur en stemgewicht, maar met gemaskeerde identiteit. De echt→pseudoniem-mapping blijft strikt lokaal (bij Mistral Lokaal), nooit naar hosting of Git.
- **P = echt**, apart geprovisioneerd en gehard (zie ADR-0005).

## Overwogen alternatieven

- **Drie trappen (O/T lokaal + P), geen A.** Afgewezen: platformspecifieke fouten en een echte proefvergadering laten zich niet lokaal aantonen; livegang zonder generale repetitie op het echte platform is te risicovol voor een eenmalig ALV-moment.
- **Vier trappen allemaal op mijn.host.** Afgewezen: verbruikt schaarse databases/subdomeinen, trager itereren, en het brengt echte PII onnodig dicht bij dev/test.
- **Echte data ook in A niet toestaan (volledig synthetisch t/m A).** Afgewezen: quorum en meerderheden moeten tegen de echte breukdelen/gewichten worden getest; volledig fictieve verdeling maakt de generale repetitie onbetrouwbaar. Pseudonimisering met behoud van gewichten is het verantwoorde midden.

## Gevolgen

- A vraagt een derde database + subdomein op `.starter`; capaciteit is een inrichtingspunt bij mijn.host, geen aanname.
- Mistral Lokaal wordt een kritieke afhankelijkheid vóór T (synthetische data) en A (pseudonimisering); zie de setup-runbook.
- Elke promotie krijgt een poort met bewijs (OTAP-opzet §4). Terugkoppelen van data/artefacten "stroomopwaarts" is verboden.
- Een wijziging van deze topologie of datastrategie vereist een nieuwe ADR die deze "supersedes".
