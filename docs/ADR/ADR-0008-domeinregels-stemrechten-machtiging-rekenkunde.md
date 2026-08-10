# ADR-0008 — Domeinregels: stemrechten over sub-VvE's, machtiging bij login, exacte rekenkunde

**Status:** geaccepteerd
**Datum:** 10 augustus 2026
**Beslisser:** Bas (domein/juridisch); vastgelegd door Claude (Architect & Validator)
**Context-links:** [[ADR-0002]] (row-level filtering, atomair sluiten), [[ADR-0006]] (stem hoort bij appartementsrecht), validatienotitie `docs/gates/Claude-validatie-sprint1.md`

## Context

Bij de validatie van PR #1 kwamen drie blijvende domeinregels naar boven die het gedrag en de tests structureel bepalen. Ze zijn geen sprint-detail maar horen in de waarheid.

## Besluit

### 1. Meerdere stemrechten over sub-VvE's — nooit samenvoegen

Een eigenaar kan in **twee** sub-VvE's rechten hebben. In de situatie van De Bij is dat altijd **PG (parkeren)** plus **één** van **TF (transformatie)** of **NB (nieuwbouw)** — dus de geldige combinaties zijn `{PG, TF}` of `{PG, NB}`. Elk recht (`entitlement.splitsing_code`) is een zelfstandige stem met een eigen gewicht; rechten worden **nooit** samengevoegd (bevestigt ADR-0006). De eigenaar stemt per recht apart en ziet uitsluitend zijn eigen rechten (row-level, server-side, ADR-0002 regel 4). Test- en pseudonimiseringsdata (T en A) **moeten** eigenaars met `{PG,TF}` en `{PG,NB}` bevatten.

### 2. Machtiging vervalt onherstelbaar zodra de eigenaar inlogt

Heeft een eigenaar voor een recht een **machtiging** (papieren volmacht/stemformulier) afgegeven en logt hij ten tijde van de ALV tóch zelf in, dan **vervalt die machtiging voor dat recht onmiddellijk en onherstelbaar**. Het systeem markeert de machtiging als vervallen (geauditeerd, servertijd-UTC) op het moment van authenticeren; er is geen herstel binnen die vergadering. Dit voorkomt dubbele stemuitbrenging per recht. De regel wordt óók opgenomen in de voorwaarden/instructie-tekst (menselijke tekst-taak, Bas). Let op: dit is géén digitaal machtigingsbeheer (dat blijft buiten scope, v0.1.0), maar een conflictregel tussen papieren machtiging en digitale aanwezigheid.

### 3. Exacte stemgewicht-rekenkunde — geen drijvende komma

Stemgewichten/breukdelen worden **exact** verwerkt. `entitlement.weight` is `DECIMAL(12,4)`; aggregatie gebeurt met exacte decimal-rekenkunde — bij voorkeur in SQL (`SUM(weight)` levert exact decimal) of anders via geheeltallige schaling in de app. **Geen** `Number()`-accumulatie in JavaScript (dat herintroduceert drijvende-komma-drift op precies de quorum-/2⁄3-drempels). Ronden gebeurt alleen voor weergave; quorum- en meerderheidsdrempels worden tegen de exacte totalen getoetst. (Bas' minimale voorstel `round:3` bij het sommeren is de ondergrens; exacte decimal-/integer-verwerking is de norm.)

## Overwogen alternatieven

- **Rechten van dezelfde eigenaar samenvoegen tot één stem.** Afgewezen: juridisch onjuist en verhult de aparte splitsingen; ADR-0006 vereist scheiding.
- **Machtiging naast digitale login laten bestaan.** Afgewezen: risico op dubbele stem per recht; de login is het meest recente, expliciete signaal en wint.
- **Float met `round:3`.** Afgewezen als norm (wel als ondergrens): drijvende komma kan net op de drempel omslaan; exact decimal/integer sluit dat uit.

## Gevolgen

- Codex: implementeer row-level autorisatie per recht (de TODO in `VoteStoreMariaDB.recordVote`), de machtiging-vervalt-bij-login-transitie (geauditeerd), en vervang de placeholder-aggregatie door exacte decimal-/SQL-rekenkunde.
- Gemini: testdata + tests dekken `{PG,TF}` en `{PG,NB}`, machtiging-vervalt-bij-login, en drempelgevallen van quorum/meerderheid met exacte gewichten.
- Mistral: synthetische (T) en gepseudonimiseerde (A) datasets bevatten de multi-VvE-combinaties.
- Bas: neemt de machtiging-regel op in de voorwaarden/instructie-tekst.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
