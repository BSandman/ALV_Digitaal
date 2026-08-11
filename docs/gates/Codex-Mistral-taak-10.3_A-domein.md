# Taak 10.3 — Acceptatie-domein op mijn.host (Codex + Mistral) — Sprint 2

**Status:** klaargezet, start pas na afronding Sprint 1 en Bas' akkoord. Mistral Lokaal draait (Nemo) — geen blokkade meer.
**Referenties:** `OTAP_opzet_v1.0.0.md` §3–§4, ADR-0004 (A = gepseudonimiseerd), ADR-0005 (PII buiten release), `bijbel.md` §3.
**Doel:** `acceptatie.honigfabriek.nl` als werkende A-omgeving op mijn.host `.starter`, gescheiden van productie.

## Omgevingscoördinaten (door Bas aangemaakt, 11 aug — géén wachtwoorden hier)

| Omgeving | Subdomein | DB-host | DB-naam | DB-user |
|---|---|---|---|---|
| A — Acceptatie | `acceptatie.honigfabriek.nl` | `localhost` | `cn111993_acceptatie` | `cn111993_acceptatie` |
| P — Productie | `portaal.honigfabriek.nl` | `localhost` | `cn111993_portaal` | `cn111993_portaal` |

De **wachtwoorden** staan uitsluitend in het server-side secrets-bestand per omgeving (ADR-0012), nooit in Git of het artefact. A en P delen nooit een database (ADR-0004).

**Deploy-coördinaten (SSH, niet-geheim — bij voorkeur als GitHub repo-variables, niet hardcoded):** host `217.180.14.63`, poort `26`, user `cn111993`. App-root wordt bepaald bij het aanmaken van de Node.js-app in DirectAdmin (`Setup Node.js App`); parametriseer `deploy.sh` daarop (`REMOTE_DIR`). De SSH-privé-sleutel leeft uitsluitend in GitHub Secret `ACC_SSH_KEY` (ADR-0013).

## Codex — infrastructuur & deploy

- Richt op mijn.host een **apart subdomein** `acceptatie.honigfabriek.nl` in met een **eigen application root** en een **eigen (derde) MariaDB-database**, volledig gescheiden van `portaal.honigfabriek.nl` (P). A en P delen nooit een database.
- Werk `scripts/deploy.sh` bij: het staat nu op `stem.honigfabriek.nl` en één doel. Maak **twee doelen** — `acceptatie` en `portaal` — met per doel `SSH_HOST`, `REMOTE_DIR` en healthz-URL. Standaardgedrag: deploy naar **acceptatie** eerst; productie alleen na expliciete vlag + Bas' go.
- Voer de per-verbinding strikte `sql_mode` door tegen de mijn.host-MariaDB (ADR-0003), en verifieer `X-Forwarded-For`-gedrag achter LiteSpeed op de echte host.
- Release-artefact blijft **alleen code** (ADR-0005); data komt via Mistral, apart.

## Codex — CD-automatisering (ADR-0013)

- Maak `deploy.sh` **non-interactief + idempotent**, met een healthcheck ná deploy.
- Bouw `.github/workflows/deploy-acceptatie.yml` met **`workflow_dispatch`** (handmatige knop): checkout, SSH-setup uit secret `ACC_SSH_KEY`, `deploy.sh` naar acceptatie, healthcheck. Host/poort/user/app-pad als niet-geheime config/vars.
- Zet de **productie**-workflow op achter een GitHub Environment `production` met required reviewer (Bas) — opgezet maar nog niet gebruikt (pas bij echte P-livegang).
- Geen secrets in de repo (ADR-0005/0012); alleen `SECRETS_FILE`-verwijzing en de niet-geheime SSH-config.

## Mistral — data & gates

- Lever de **gepseudonimiseerde** set (`mistral-lokaal/out/pseudo/owners.pseudo.json`, script C2) en provisioneer die naar de A-database, los van de codedeploy. De echt↔pseudoniem-mapping blijft in `secure/`.
- PII-scan-gate schoon vóór de A-deploy (artefact, fixtures, diff).
- **Secrets-locatie op de host vastleggen** (openstaand punt v0.2.0 §8): DirectAdmin-env of configbestand buiten de webroot met strakke rechten. Geen secrets in Git of in het artefact. Leg de gekozen route vast in een ADR.
- **Hersteltest:** oefen export én herstel op A vóór er sprake is van P — een niet-geoefend herstel bestaat niet. Twee herstelpunten (application root + data, met tijdstempel + SHA-256) worden de vaste regel richting P.

## Definition of done (10.3)

- `acceptatie.honigfabriek.nl` draait, eigen DB, met gepseudonimiseerde data; een testronde is end-to-end te doorlopen.
- `deploy.sh` deployt reproduceerbaar naar A; productiepad staat achter een expliciete vlag + go.
- Secrets-locatie vastgelegd (ADR); geoefende export/herstel op A.
- Handoff via de zes delen; privacyclassificatie schoon.

## Buiten scope

Livegang naar P (aparte A→P-poort, menselijke go van Bas) en productfunctionaliteit.
