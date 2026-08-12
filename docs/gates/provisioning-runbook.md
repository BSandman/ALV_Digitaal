# G3-runbook — idempotente CloudLinux-provisioning

## Lokale bron

Maak per doel een lokaal, door Git genegeerd bestand:

- `mistral-lokaal/secure/alv-acceptatie.env`
- `mistral-lokaal/secure/alv-portaal.env`

Het bestand bevat exact `DEPLOY_TARGET`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `AUTH_PEPPER`, `TRUST_PROXY`; geen `NODE_ENV`, SMTP- of andere sleutels. Gebruik `DB_HOST=localhost`, `DB_PORT=3306`, `TRUST_PROXY=1` en de doelgebonden database/user. Zet op POSIX `chmod 600`.

Test zonder verbinding:

```bash
scripts/provision_env.sh --target acceptatie --dry-run
```

Echte acceptatie-inrichting gebruikt dezelfde `ACCEPTATIE_SSH_HOST`, `ACCEPTATIE_SSH_PORT`, `ACCEPTATIE_REMOTE_DIR`, `ACCEPTATIE_NODE_BIN` en optionele `ACCEPTATIE_SECRETS_FILE` als de deployworkflow:

```bash
scripts/provision_env.sh --target acceptatie
```

Productie blijft dubbel vergrendeld:

```bash
BAS_PRODUCTION_GO=JA scripts/provision_env.sh --target portaal --allow-production
```

Herhalen is veilig: gelijke inhoud blijft ongewijzigd; gewijzigde, volledig geldige inhoud wordt atomisch geplaatst. De secretwaarden worden niet gelogd. Het definitieve bestand eindigt altijd met mode `600`.

## Eenmalige DirectAdmin-stappen

Deze control-panelinstellingen kan het SSH-script niet betrouwbaar aanmaken of uitlezen en moeten na provisioning handmatig worden bevestigd:

1. Maak de Node.js-app aan voor het juiste domein met **Node 20**, Application mode **Production** en application root `nodeapp`.
2. Startup file is `src/start.js`; voeg geen handmatige `PORT` toe.
3. Zet de DirectAdmin-omgevingsvariabele `SECRETS_FILE` exact op `/home/cn111993/secrets/alv-acceptatie.env` of `/home/cn111993/secrets/alv-portaal.env`. Zet geen secretwaarden en geen `NODE_ENV` in het secretsbestand.
4. Controleer dat het app-specifieke nodevenv-pad overeenkomt met `*_NODE_BIN` en herstart de applicatie via DirectAdmin of `nodeapp/tmp/restart.txt`.
5. Controleer na een codedeploy `/healthz`: HTTPS groen en `"database":"up"`. LiteSpeed moet de inkomende `X-Forwarded-For` overschrijven; de app gebruikt `TRUST_PROXY=1` voor precies één gecontroleerde hop.

`provision_env.sh` controleert vóór installatie dat de actuele `src/start.js` via Node 20 synchroon met `require()` kan worden geladen zonder `ERR_REQUIRE_ASYNC_MODULE`, met de nieuwe secretsbron via `SECRETS_FILE`.
