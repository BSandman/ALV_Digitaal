# ADR-0013 — CD-automatisering: acceptatie handmatig-getriggerd, productie achter approval

**Status:** geaccepteerd
**Datum:** 11 augustus 2026
**Beslisser:** Bas; vastgelegd door Claude (Architect & Validator)
**Context-links:** [[ADR-0001]] (Docker alleen dev/test — geen Docker-push naar prod), [[ADR-0002]] (A→P-poort), [[ADR-0005]]/[[ADR-0012]] (secrets), OTAP-opzet §4

## Context

CI is al geautomatiseerd (gates + Gemini-review op elke PR). CD (deployen) is nog handmatig. Sprint 3 bouwt `deploy.sh`; we maken die meteen aanroepbaar vanuit GitHub Actions. Productie is een live stemsysteem — daar past geen ongeziene auto-deploy.

## Besluit

1. **Acceptatie — handmatig getriggerd.** Een workflow `deploy-acceptatie.yml` met **`workflow_dispatch`** (een knop in GitHub Actions) draait `deploy.sh` over SSH naar `acceptatie.honigfabriek.nl`. `push`-op-merge kan later worden toegevoegd zodra dit een paar keer soepel liep (Bas' keuze, 11 aug: handmatig eerst).
2. **Productie — nooit automatisch.** Een aparte workflow achter een **GitHub Environment `production`** met **required reviewer (Bas)**. Alleen op een expliciete tag/dispatch, met verplichte approval, geoefend herstel en dubbel herstelpunt (ADR-0002 / OTAP A→P-poort). Het platform dwingt zo het go-moment af.
3. **SSH via deploy-keypair.** Privé-sleutel in **GitHub Secrets** (bijv. `ACC_SSH_KEY`), publieke sleutel in DirectAdmin → SSH Keys. Host/poort/gebruiker/app-pad als niet-geheime workflow-config of repo-variables. Geen secrets in Git (ADR-0005/0012).
4. **`deploy.sh` non-interactief + idempotent**, met een healthcheck ná deploy (rooktest tegen de omgevings-URL).

## Overwogen alternatieven

- **Auto-op-merge naar acceptatie (nu).** Afgewezen als startpunt; later optioneel. Elke merge zou meteen de echte hosting raken.
- **Auto-deploy naar productie.** Afgewezen: legale/AVG-inzet; menselijke go blijft verplicht.
- **`docker push` naar productie.** Afgewezen: shared hosting zonder Docker (ADR-0001).

## Gevolgen

- Codex bouwt in Sprint 3 de acceptatie-deployworkflow; de productieworkflow + Environment-approval worden opgezet maar pas gebruikt bij de echte P-livegang.
- Bas: genereer het deploy-keypair (privé → GitHub Secret, publiek → DirectAdmin) en stel de `production`-Environment met zichzelf als reviewer in.
- **Buiten scope van deze ADR:** de "agent-autorun" (watchers die Codex/Claude/Mistral onbemand uitvoeren) — aparte track, later, met eigen vangrails.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
