# sprint.md — Sprint 1: Fundament

**Doel:** de T-omgeving draait reproduceerbaar en de CI-gates zijn groen. Geen productfunctionaliteit; dit is het fundament waar alle latere sprints op leunen (v0.2.0 Fase 0.5). Kan starten zonder Mistral: T valt terug op een ingecheckte fictieve mini-seed.

**Sprintversie:** app `v0.1.0` (eerste code). Achtergrond in `bijbel.md`; detailopdracht in `docs/gates/Codex-taak-10.2_T-run-en-CI-gates.md`.

## Scope per rol

**Codex (dev):**
- `docker compose --profile dev --profile loadtest up` → werkende T (app single-process, MariaDB 11.8.8, proxy met `X-Forwarded-For`, k6).
- Seedroute: synthetisch uit Mistral indien aanwezig, anders fictieve mini-seed. Nooit echte data.
- CI-gate A (arch-regels ADR-0002) en gate B (PII-scan ADR-0005, deterministische kern in `mistral-lokaal/scripts/pii_scan`).
- Release-artefact = alleen code; versie via `package.json` + git-tag.

**Gemini (test):**
- k6 120-clients-burst draait tegen T met bewijs (aantallen, latency, foutratio).
- Regressieharnas dat de bestaande ALV-rekenregels vastpint (quorum, PG-blok, meerderheden) — rood/groen bewijs.
- Negatieftest: een artefact met `owners.initial.js` erin **moet** gate B laten falen.

**Claude (validatie):**
- Toets dat gate A de zes regels echt afdwingt (geprepareerde overtreding faalt aantoonbaar).
- Domeinvalidatie op de acceptatiecriteria; noteer gaps als ADR/gate.

**Mistral (integratie):**
- PII-scan-gate scherp zetten en aan `scripts/deploy.sh`-voorbereiding hangen (nog geen deploy).
- Bevestig: geen echte PII in repo/CI/fixtures.

## Definition of done (sprint)

- T start met één commando en synthetische/mini-seed-data.
- Gate A en B draaien in CI en falen aantoonbaar op een geprepareerde overtreding (regressie op het fase-1-`owners.js`-lek is groen = faalt correct).
- Gemini's burst + regressie groen met vastgelegd bewijs.
- Handoff-keten één keer volledig doorlopen O→T→validatie→integratie zonder `BLOCKED`.
- `progress.md` bijgewerkt; app getagd `v0.1.0`.

## Buiten scope

A-domein op mijn.host (Sprint 2, na Mistral-setup) · productcode/domeinfunctionaliteit · pseudonimisering voor A.
