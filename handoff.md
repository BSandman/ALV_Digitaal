---
sprint: 2
state: READY_FOR_INTEGRATION
owner: mistral
since: 2026-08-11T11:21:28Z
next: claude
action_required_by: none
blocked: false
note: "PR #4 is groen; Mistral draait C1/C2 voor M1 en bevestigt de lokale privacy- en integratiegate."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 2 — C1/C2 gereed voor Mistral-integratie (M1).**

**Datum/tijd (UTC):** 2026-08-11 11:21:28
**Versie/commit:** PR #4, code t/m `2a8da8e`

### 1. Doel

C1 en C2 deblokkeren M1: reproduceerbare fictieve T-data en lokaal gepseudonimiseerde A-data, met schema-gelijke rechten, exacte gewichten en privacygrenzen conform ADR-0004/0005/0008/0009/0010.

### 2. Gewijzigde bestanden

`mistral-lokaal/scripts/gen_synthetic.mjs`, `mistral-lokaal/scripts/pseudonymize.mjs`, `mistral-lokaal/README.md`, `infra/mysql/prepare-seed.mjs`, `infra/docker-compose.yml`, `infra/.env.example`, `app/package.json`, `tests/dataset-tools.test.mjs`, `tests/seed-preparer.test.mjs`.

### 3. Testbewijs

42/42 unit-/contracttests, architectuur- en releasegate, PII-gate en Compose-config groen. C1 draaide via lokaal `mistral-nemo:latest`. Verse MariaDB 11.8.8-load: 12 deelnemers, 24 losse rechten, 12 gehashte credentials, 12 presentieregels en 3 machtigingen; PG/TF/NB elk exact `10000.0000`; één presentie+machtiging-overlap telde eenmaal. GitHub gates + Gemini-review op PR #4 groen.

### 4. Privacyclassificatie (Mistral-gate)

Repo/diff/fixtures bevatten geen echte PII. C1 is volledig fictief. C2 weigert invoer, sleutel en mapping buiten `mistral-lokaal/secure/`; uitvoer kopieert geen naam, adres, e-mail of echte toegangscode. Lokale en CI-PII-gate: groen.

### 5. Open risico's

Mistral moet C1 en C2 nog tegen de lokale M1-bronnen draaien en de gegenereerde uitvoer opnieuw scannen. Niet exact naar vier decimalen omzetbare breuken worden bewust fail-closed geweigerd omdat het databaseschema `DECIMAL(12,4)` voorschrijft. Niet-offline namen kunnen per modelversie variëren; `--offline --seed` is byte-reproduceerbaar.

### 6. Rollback

Revert de C1/C2-commits `df7b333`, `ebbdca2` en `2a8da8e`; verwijder daarna uitsluitend de gitignored gegenereerde mappen `mistral-lokaal/out/` en, indien gewenst, de lokaal aangemaakte C2-mapping/sleutel in `mistral-lokaal/secure/`.

**Gate-uitslag:**

- [ ] Claude — C1/C2-domeinvalidatie
- [x] Gemini — PR-review en gates
- [ ] Mistral — privacy- & integratiegate (nu aan zet)
- [ ] Bas — go/no-go

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-11 — Codex: EOL genormaliseerd, PR #2 (`e6d0684`) + A8/PR #3 (`cfdee79`) gemerged; 37/37 groen. → READY_FOR_INTEGRATION.
- 2026-08-11 — Claude: M1 vereist C1/C2 (bestaan nog niet) → gericht teruggedragen aan Codex met de C1/C2-taak. → READY_FOR_DEV.
- 2026-08-11 — Codex: C1/C2 gebouwd en bewezen op PR #4; 42/42, MariaDB 11.8.8, PII, gates en Gemini groen. → READY_FOR_INTEGRATION.
