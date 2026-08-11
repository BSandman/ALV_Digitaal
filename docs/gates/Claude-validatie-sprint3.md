# Claude-validatie — Sprint 3 / PR #5 (Acceptatie-config + CD)

**Rol:** Claude — Architect & Validator
**Datum:** 11 augustus 2026
**Onderwerp:** PR #5 — `deploy.sh`, `deploy-acceptatie.yml`/`deploy-productie.yml`, `SECRETS_FILE`-bootstrap.

## 1. Oordeel: GROEN (code), met deploy-config-afstemming voor Bas

Getoetst tegen ADR-0002/0003/0005/0012/0013:

- **Atomaire deploy + rollback** — `releases/<id>` + `current`-symlink, `restart.txt`, rollback naar vorige release. Sterk. ✓
- **Secrets buiten webroot afgedwongen** — `deploy.sh` weigert een secrets-pad binnen de app-root (exit 12); `secrets-file.js` eist absoluut pad, buiten app-root, `chmod 600`. ✓ (ADR-0012)
- **Twee doelen, dubbele productiepoort** — acceptatie default; portaal vereist `--allow-production` + Environment-approval. ✓ (ADR-0013)
- **CD** — `deploy-acceptatie.yml` op `workflow_dispatch`, alleen vanaf `main`, SSH via `ACC_SSH_KEY`, healthz-check. ✓
- **DB/sql_mode/`X-Forwarded-For`/healthz** — vaste coördinaten, per-verbinding sql_mode, db-afhankelijke `/healthz`. ✓
- **Entry** — `src/start.js` laadt eerst `SECRETS_FILE` (`loadRuntimeConfiguration`), dan `server.js`. Correct: secrets vóór start.

Bewijs: 57/57 tests, gates + Gemini groen, droge A/P-runs + tijdelijke MariaDB-bootstrap groen.

## 2. Deploy-config-afstemming (Bas, DirectAdmin + GitHub) — geen code-blokker

De DirectAdmin Node-app moet matchen met de deploy-layout:

- **Application root:** `domains/acceptatie.honigfabriek.nl/nodeapp/current` (Codex draait de live code onder `.../nodeapp/current`; `deploy.sh` regel 116/194–196). **Niet** `nodeapp` zelf.
- **Application startup file:** `src/start.js` (niet `server.js`) — start.js is de secrets-loader; anders laden de secrets niet.
- Tot de eerste deploy bestaat `current` nog niet → Passenger toont een fout tot dan; normaal.

GitHub (voor de workflow): repo-variables `ACCEPTATIE_SSH_HOST=217.180.14.63`, `ACCEPTATIE_SSH_PORT=26`, `ACCEPTATIE_REMOTE_DIR=/home/cn111993/domains/acceptatie.honigfabriek.nl/nodeapp`; secret `ACC_SSH_KEY` (deploy-privésleutel). `ACCEPTATIE_SECRETS_FILE` en `_HEALTH_URL` hebben goede defaults.

## 3. Bij de eerste echte deploy te verifiëren (blok 4, niet vóór merge)

LiteSpeed zet `X-Forwarded-For` single-hop; Passenger geeft `SECRETS_FILE` door aan het proces; Environment-reviewer (Bas) staat goed. Deploy tijdens een open stemronde blijft een operationele no-go.

## 3b. Platform-vondst (blok 4): current-symlink botst met CloudLinux Node Selector

Bij het wijzigen van de app-root naar `nodeapp/current` faalt CloudLinux met "Cannot move a directory into itself" — de Node Selector relocate't de nodevenv en kan de app-root niet in zijn eigen submap zetten. Het capistrano-achtige `releases/`+`current`-model botst met de vaste, beheerde app-root + nodevenv van CloudLinux.

**Besluit (correctie op deploy-mechanisme, ADR-0013 (CD)-lijn blijft):** deploy **in-place** in de door CloudLinux beheerde app-root (`nodeapp`), met een getimestampte backup voor rollback en Passenger-herstart via `nodeapp/tmp/restart.txt`. Geen `current`-symlink.
- **DirectAdmin:** app-root = `nodeapp` (niet `/current`), startup `src/start.js`, mode Production (`NODE_ENV=production` activeert de `SECRETS_FILE`-eis).
- **Codex (fix):** pas `deploy.sh` aan naar in-place deploy + backup-rollback; `ACCEPTATIE_REMOTE_DIR` blijft `.../nodeapp`. Deploy blijft een no-go tijdens een open stemronde.

## 4. Verdict

PR #5 goedgekeurd voor merge (code correct). Baton → Codex (merge PR #5) → blok 4: Bas stemt DirectAdmin/GitHub af, Mistral draait C2 met de echte export, dan de eerste echte A-deploy via de workflow-knop.
