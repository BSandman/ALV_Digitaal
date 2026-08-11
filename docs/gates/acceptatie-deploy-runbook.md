# Runbook — acceptatie.honigfabriek.nl

Dit runbook voert Sprint 3 blok 4 uit nadat PR-gates en Claude-validatie groen zijn. Code en data blijven aparte stromen: `deploy.sh` raakt uitsluitend het code-artefact; Mistral provisioneert de gepseudonimiseerde C2-data afzonderlijk.

## 1. Eenmalige serverinrichting (Bas)

1. Maak buiten application root en webroot `/home/cn111993/secrets/alv-acceptatie.env` op basis van `config/alv-acceptatie.env.example`.
2. Vul de echte waarden lokaal op de server in en zet `chmod 600`; commit, upload of plak die waarden nergens anders.
3. Configureer de DirectAdmin Node-app met de vaste application root `<ACCEPTATIE_REMOTE_DIR>` (`.../nodeapp`, zonder `current`-submap), startupbestand `src/start.js`, Node 20 en mode Production.
4. Zet in DirectAdmin uitsluitend `SECRETS_FILE=/home/cn111993/secrets/alv-acceptatie.env`. De bootstrap zet vervolgens productiegedrag en valideert dat de databasecoördinaten bij `acceptatie` horen.

## 2. Code-artefact en dry-run

```bash
npm ci --prefix app --no-audit --no-fund
npm test --prefix app
npm run build:release --prefix app

export ACCEPTATIE_SSH_HOST='<user>@<mijn.host-ssh-host>'
export ACCEPTATIE_SSH_PORT='<door-Bas-bevestigde-poort>'
export ACCEPTATIE_REMOTE_DIR='<absoluut-door-Bas-bevestigd-app-pad>'
export ACCEPTATIE_NODE_BIN='<app-specifiek-nodevenv-bin-pad>'
scripts/deploy.sh --target acceptatie --dry-run
```

Gebruik daarna het door CI bewaarde code-only artefact of de lokaal identiek gebouwde `.tgz`:

```bash
scripts/deploy.sh --target acceptatie --confirm-no-open-round --artifact dist/alv-digitaal-app-v0.2.0.tgz
```

Voer de echte deploy alleen uit nadat is gecontroleerd dat geen stemronde openstaat. Het script controleert de PII-gate, SHA-256 en server-side secretslocatie/rechten. Het valideert `ACCEPTATIE_NODE_BIN` als app-specifieke CloudLinux-nodevenv onder `/home/<ssh-user>/nodevenv/.../bin` en zet die vóór de remote commandocontrole, installatie en eventuele rollback op `PATH`. Daarna maakt het buiten de CloudLinux app-root een getimestampte backup onder `<ACCEPTATIE_REMOTE_DIR>.deploy/backups/`, synchroniseert uitsluitend `src/` en de package-manifesten in-place, draait `npm ci --omit=dev`, triggert Passenger via `<ACCEPTATIE_REMOTE_DIR>/tmp/restart.txt` en vereist een HTTPS-healthcheck met werkende database. Een installatie- of healthfout herstelt de vorige code uit de backup en installeert de bijbehorende dependencies opnieuw. De app-root zelf wordt nooit verplaatst of door een `current`-symlink vervangen.

Na inrichting kan dezelfde acceptatiedeploy handmatig via GitHub Actions → **Deploy acceptatie**. Benodigde repository-/environmentconfig:

- secret `ACC_SSH_KEY`;
- variables `ACC_SSH_USER`, `ACC_SSH_HOST`, `ACC_SSH_PORT`, `ACC_REMOTE_DIR`, `ACC_NODE_BIN`, `ACC_SECRETS_FILE` en de vooraf buiten GitHub gecontroleerde hostkeyregel `ACC_SSH_KNOWN_HOSTS`; voor Node 20 op deze app is `ACC_NODE_BIN=/home/cn111993/nodevenv/domains/acceptatie.honigfabriek.nl/nodeapp/20/bin`;
- workflow starten vanaf `main` (andere refs worden geweigerd) en het verplichte vak bevestigen dat geen stemronde openstaat.

## 3. Verificatie op A

- Bevestig dat `/healthz` HTTP 200 en `"database":"up"` retourneert.
- Verifieer in de echte LiteSpeed-route dat precies één geldige `X-Forwarded-For`-waarde de app bereikt; een keten met meerdere waarden moet `UNVERIFIED_CLIENT_IP` opleveren.
- Mistral draait C2 lokaal, scant `mistral-lokaal/out/pseudo/` en provisioneert de dataset los van het code-artefact.
- Doorloop quorum, openen, stemmen, sluiten, auto-onthouding en uitslag end-to-end.
- Exporteer A, herstel die export in de afgesproken herstelomgeving en leg tijdstip plus SHA-256 vast.

## 4. Productie blijft dicht

`portaal` is technisch voorbereid maar wordt geweigerd tenzij zowel `--allow-production` als `BAS_PRODUCTION_GO=JA` aanwezig zijn. De workflow **Deploy productie** vereist daarnaast een bestaande release-tag, exacte domeinbevestiging, een doelgebonden `PROD_NODE_BIN` en het GitHub Environment `production`. Bas moet daar als required reviewer worden ingesteld. Dat is geen toestemming om nu naar productie te deployen; de latere A→P-poort en expliciete go van Bas blijven vereist.
