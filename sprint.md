# sprint.md — Sprint 3: Acceptatie (10.3 A-domein)

**Doel:** de gevalideerde backend (main, v0.2.0) draaiend krijgen op **`acceptatie.honigfabriek.nl`** — het echte mijn.host-platform bewijzen (Passenger, MariaDB 11.8.8, secrets buiten webroot) vóór de frontend erop komt. Detailopdracht: `docs/gates/Codex-Mistral-taak-10.3_A-domein.md`. Besluiten: ADR-0002/0003/0004/0005/0012.

## Cadans — blokken

| Blok | Rol | Watcher | Inhoud |
|---|---|---|---|
| 0 | **Codex** (klein) | `--role codex` | Eerst: docs-commit van de losse architect-docs (ADR-0012 e.d.) naar `main` |
| 1 | **Codex** (dev/infra) | `--role codex` | `deploy.sh` (non-interactief) + app-config voor acceptatie (DB-coords, `SECRETS_FILE`/ADR-0012, healthz, sql_mode, `X-Forwarded-For`) **+ CD-workflow `deploy-acceptatie.yml` (workflow_dispatch, ADR-0013)** + productie-workflow achter Environment-approval; PR |
| 2 | *auto* | — | CI-gates + Gemini-review |
| 3 | **Claude** (validatie) | `--role claude` | Deploy-config tegen ADR-0002/0003/0005/0012; herstelprocedure als harde eis |
| 4 | **Mistral + Bas** | `--role mistral` | C2 met de echte export → A-data; deploy naar acceptatie; testronde end-to-end; PII schoon; geoefend herstel |

## Bas — handmatige infra (parallel, DirectAdmin/SSH)

- DirectAdmin **Node.js-app** op `acceptatie` aanmaken (Node 20, app-root, startup-file) — pas koppelen als de code klaar is om te deployen.
- **Secrets-`.env`** op de server: `/home/cn111993/secrets/alv-acceptatie.env` (`chmod 600`), met DB-wachtwoord (`cn111993_acceptatie`), credential-pepper, SMTP. Zet in de DirectAdmin-env alleen `SECRETS_FILE` naar dat pad (ADR-0012).
- **SSH-toegang** bevestigen voor `deploy.sh` (host/pad).
- De **echte eigenaars-export** lokaal in `mistral-lokaal/secure/owners.real.json` zetten zodat C2 kan draaien (blijft lokaal, ADR-0005).

## Definition of done

- `acceptatie.honigfabriek.nl` draait de backend op de eigen DB, met **gepseudonimiseerde** data (C2).
- Een **stemronde end-to-end** doorlopen (via API): quorum vaststellen, ronde openen/sluiten, auto-onthouding, uitslag — op het echte platform.
- Secrets uit een `.env` buiten de webroot via `SECRETS_FILE`; geen secrets/PII in Git of artefact.
- **Geoefend** export + herstel op A (een niet-geoefend herstel bestaat niet).
- `deploy.sh` deployt reproduceerbaar naar acceptatie; productiepad (`portaal`) staat achter een expliciete vlag + latere Bas-go.

## Open te verifiëren (spike / mijn.host-support)

Passenger cold start + doorgifte van `SECRETS_FILE` aan het Node-proces; entry-process- en MySQL-connectielimieten op `.starter` (v0.1.0 §13). Geen aannames; vastleggen in een ADR/notitie.

## Buiten scope

Productie-deploy naar `portaal` (aparte A→P-poort + Bas-go) · de frontend (Sprint 4) · een echte proefvergadering met mensen (vereist de frontend).
