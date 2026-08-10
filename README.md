# ALV_Digitaal — digitaal ALV-eigenaarportaal

Mobiele eigenaarstoegang naast de bestaande VvE-beheerapp: digitale presentie en gewogen
stemrondes tijdens de ALV. Productie draait op mijn.host `.starter` (shared hosting).
Docker in deze repo is **uitsluitend** voor dev/test/CI en bootst dat platform na — zie
`docs/ADR/ADR-0001`.

---

## ⇢ START HIER (dit bestand is de enige ingang)

Elke AI en Bas beginnen bij deze README. Van hieruit vind je je weg: wat je leest, wat je doet, wat je schrijft. Lees altijd eerst deze vier:

1. **`bijbel.md`** — de waarheid (architectuur, besluiten, ADR's). Bij twijfel wint de bijbel.
2. **`AGENTS.md`** — de spelregels: statemachine, handoff-protocol, 60s-race-guard, git.
3. **`sprint.md`** — wat we NÚ doen (huidige sprint).
4. **`handoff.md`** — wie op dit moment aan zet is (de estafettestok). **Alleen de huidige `owner` schrijft hierin.**

Werk daarna volgens je rol. Per rol één charter dat je precies vertelt wat te doen:

| Zeg tegen | Lees jouw charter | Je werkt als `handoff.md`-state = | Je schrijft |
|---|---|---|---|
| **Codex** | `docs/gates/Codex-instructie.md` | `READY_FOR_DEV` | code in `app/`, `handoff.md`, `progress.md` |
| **Gemini** | `docs/gates/Gemini-instructie.md` | `READY_FOR_TEST` | tests/bewijs, `handoff.md`, `progress.md` |
| **Claude** | (architectrol) `bijbel.md` + ADR's | `READY_FOR_VALIDATION` | ADR's/criteria, `handoff.md`, `progress.md` |
| **Mistral** | `docs/gates/Mistral-instructie.md` | `READY_FOR_INTEGRATION` | scripts, deploy, `handoff.md`, `progress.md` |
| **Bas** | deze README + `progress.md` | `BLOCKED` / `action_required_by: bas` | beslissingen, go/no-go |

Elke rol overdraagt via het zesdelige `docs/gates/handoff-template.md`. Details van je taak staan in je charter; alle achtergrond staat in `bijbel.md` — houd `handoff.md`/`progress.md` daarom kort (tokens laag).

**Eén schrijver op de waarheid:** alleen Claude (Architect) wijzigt `README.md` en `bijbel.md`. Wil je hier iets in aangepast hebben, meld het via `handoff.md` (`note` of `BLOCKED`); Claude verwerkt het.

**Huidige status:** zie `handoff.md` (state + owner) en `progress.md` (verslag).

---

Achtergronddocumenten (via de bijbel te vinden, hier voor de volledigheid):
volledig voorstel `docs/Architectuur_en_infravoorstel_v0.2.0.md` · OTAP-opzet `docs/OTAP_opzet_v1.0.0.md` ·
Mistral-runbook `docs/Mistral_Lokaal_setup_runbook_v1.0.0.md` · bron-ontwerp `Eerste_opzet_digitale_ALV_eigenaarportaal_v0.1.0`.

## Mappenstructuur

```
ALV_Digitaal/
  README.md                                   >>> DE INGANG — begin hier
  bijbel.md                                   de waarheid (architectuur, besluiten)
  AGENTS.md                                   spelregels: statemachine, handoff, git
  sprint.md                                   wat we NU doen
  handoff.md                                  wie aan zet is (baton; alleen owner schrijft)
  progress.md                                 werkverslag (deze + vorige sprint)
  scripts/watch_handoff.py                    referentie-watcher (per rol: --role)
  docs/
    Architectuur_en_infravoorstel_v0.2.0.md   hoofdvoorstel (beoordeling + infra)
    OTAP_opzet_v1.0.0.md                        vier-traps OTAP + promotiepoorten + repo-advies
    Mistral_Lokaal_setup_runbook_v1.0.0.md      parallelle setup voor Bas (model, data, PII-gate)
    ADR/                                        besluitregister (ADR-0001..0008, template)
    gates/handoff-template.md                   verplicht handoff-formaat tussen de 4 AI's
    gates/Codex-instructie.md                   rol-charter + Sprint 1 (dev + git-steward)
    gates/Gemini-instructie.md                  rol-charter + Sprint 1 (test)
    gates/Mistral-instructie.md                 rol-charter + fase C (3 scripts) + deploy
    gates/Codex-taak-10.2_T-run-en-CI-gates.md  Sprint 1: T-run + CI-gates
    gates/Claude-validatie-sprint1.md           validatie PR#1 + Sprint 2-acties
    gates/Codex-Mistral-taak-10.3_A-domein.md   Sprint 2: acceptatie.honigfabriek.nl
  infra/
    docker-compose.yml                          dev/test/CI-omgeving (profielen: dev, loadtest)
    Dockerfile                                  dev/test-image (single process, non-root)
    proxy/Caddyfile                             reverse proxy, zet X-Forwarded-For (LiteSpeed-pariteit)
    mysql/init/                                 schema + synthetische seed (auto-geladen)
    loadtest/vote-burst.js                      k6: 120+ deelnemers, stemburst
    .env.example                                kopieer naar .env (nooit in Git)
  app/
    package.json, src/server.js                 placeholder — Codex bouwt hier Fase 1-2
  scripts/deploy.sh                             productie-deploy naar .starter (GEEN Docker)
```

## Snel starten (dev)

Vereist: Docker Desktop.

```bash
cd infra
cp .env.example .env          # dev-defaults, fictieve waarden
docker compose up             # app + MariaDB + proxy
# app via de proxy:           https://localhost:8443/healthz
```

DB-inspectie (Adminer):

```bash
docker compose --profile dev up -d alv-adminer   # http://localhost:8081
```

## Snel starten (test — de volledige T-omgeving)

De T-trap uit de OTAP-opzet: basisrun + de profielen `dev` en `loadtest`, met synthetische data.

```bash
cd infra
docker compose --profile dev --profile loadtest up   # T-omgeving compleet
```

Losse belastingstest (120 clients + stemburst):

```bash
docker compose --profile loadtest run --rm alv-loadtest
```

CI-gates draaien automatisch op elke PR (`.github/workflows/ci.yml`): regressietests, Gate A (ADR-0002), code-only release-build en Gate B (PII-scan). De Gemini-review draait als aparte Action (`gemini-review.yml`).

## Rolverdeling en coördinatie

Rollen en routing staan in **⇢ START HIER** hierboven; de volledige regels in `AGENTS.md`.
Kern: coördinatie loopt via Git + `handoff.md` (precies één eigenaar tegelijk), een
`*_IN_PROGRESS`-state zet alle anderen stil, en tussen handoffs zit 60 s (race-guard).
Productcode loopt uitsluitend via Codex (tevens Git-steward), deploy uitsluitend via Mistral.
Bas wordt alleen benaderd bij `BLOCKED` of `action_required_by: bas`.

## Nog te bevestigen vóór de bouw

Node-versie op `.starter` (mijn.host adviseert 19/20), het Passenger-proces-/cold-start-gedrag,
bewaartermijnen + DPIA-notitie (Bas/juridisch), en de secrets-locatie op productie.
**Bevestigd:** DB = MariaDB 11.8.8 (lokale UNIX-socket); scaffold gepind op `mariadb:11.8`.
Zie voorstel §8 en ADR-0003.

## Versiebeheer

`vX.y.z` — X major, y minor, z patch. Documenten dragen de versie in de bestandsnaam;
code via `package.json` + git-tag. ADR's zijn onveranderlijk; een gewijzigd besluit krijgt
een nieuwe ADR die de oude "supersedes".
