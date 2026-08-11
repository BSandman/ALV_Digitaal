# ADR-0012 — Secrets-locatie op mijn.host: configbestand buiten de webroot

**Status:** geaccepteerd
**Datum:** 11 augustus 2026
**Beslisser:** Bas (gedelegeerd); vastgelegd door Claude (Architect & Validator)
**Context-links:** [[ADR-0005]] (PII/secrets buiten release), [[ADR-0002]] (state in DB), [[ADR-0003]] (MariaDB via socket)

## Context

De A- en P-databases zijn aangemaakt (`cn111993_acceptatie`, `cn111993_portaal`) met eigen gebruikers en wachtwoorden. ADR-0005 liet de secrets-locatie op productie open. Fase 1 zette secrets in `.htaccess` (env via Passenger) — dat willen we niet herhalen.

## Besluit

1. **Secrets in een configbestand buiten de webroot.** Per omgeving één bestand met strikte rechten (`chmod 600`), buiten elke `public_html`/document-root, bijv. `/home/cn111993/secrets/alv-acceptatie.env` en `/home/cn111993/secrets/alv-portaal.env`. Op CloudLinux is dat account-geïsoleerd en alleen leesbaar voor de account-user die de Passenger-app draait.
2. **Inhoud & formaat:** een `.env`-bestand (`KEY=VALUE`) met DB-wachtwoord, credential-pepper/HMAC-sleutel, SMTP-gegevens en admin-codes. De app laadt dit bij startup in `process.env` via één **niet-geheime** verwijzing (env-var `SECRETS_FILE` in de DirectAdmin Node-app), dotenv-stijl. Alleen `SECRETS_FILE` staat in de DirectAdmin-env; de waarden zelf niet.
3. **Nooit elders.** Geen secrets in Git, niet in het release-artefact (ADR-0005), niet in `.htaccess`, niet in de DirectAdmin-env als platte waarde. DB-naam en -gebruiker mogen in de (privé) config-template; het **wachtwoord** staat uitsluitend in het secrets-bestand op de server.
4. **Rotatie** = het bestand vervangen (en DB-wachtwoord in DirectAdmin resetten); geen code- of release-wijziging nodig.

## Overwogen alternatieven

- **DirectAdmin/Passenger env-vars als platte waarden.** Afgewezen als primair: zichtbaar in het panel, lastiger te auditeren en te roteren. (De env wordt alleen gebruikt voor de niet-geheime `SECRETS_FILE`-verwijzing.)
- **`.htaccess`-env (fase 1).** Afgewezen: secrets in een bestand in/bij de webroot; bron van het fase-1-risico.

## Gevolgen

- Codex richt in 10.3 `scripts/deploy.sh` + de app-config hierop in: lees DB/SMTP/pepper uit het secrets-bestand via `SECRETS_FILE`.
- **Te verifiëren tijdens 10.3:** dat Passenger de `SECRETS_FILE`-verwijzing correct doorgeeft aan het Node-proces op `.starter`.
- Niet-geheime coördinaten (host `localhost`, db-namen/gebruikers) staan in de 10.3-taak; wachtwoorden uitsluitend in het secrets-bestand.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
