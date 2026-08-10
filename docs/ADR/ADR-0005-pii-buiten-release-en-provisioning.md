# ADR-0005 — PII buiten het release-artefact en aparte provisioning

**Status:** geaccepteerd
**Datum:** 10 augustus 2026
**Beslisser:** Bas; voorgesteld door Claude (Architect & Validator)
**Context-links:** [[ADR-0002]] (shared-hosting-regels), [[ADR-0003]] (databasekeuze), [[ADR-0004]] (OTAP + testdata)

## Context

Bevinding tijdens de analyse (10 aug 2026): de fase-1-build verscheept eigenaars-PII **mee in het release-artefact**. Elke `dist/vve-alv-app-*.zip` bevat `data/live/owners.initial.js` (64 KB, volledige live-eigenaarslijst); builds t/m v1.7.1 plaatsten `owners.js` zelfs in `public/`, waardoor de webserver het publiek kon serveren. Code en persoonsgegevens zijn hier verweven: een artefact dat bedoeld is om te delen/uploaden bevat de PII van alle eigenaren. Dit is een AVG-risico en moet voor fase 2 structureel worden voorkomen.

## Besluit

**Scheiding van code en data.** Het release-artefact van fase 2 bevat **uitsluitend code**. Nooit meegeleverd: `owners.*`, `events.json`, `audit.log`, `cycle.json`, snapshots of enige runtime-/persoonsdata.

**Data leeft apart.** Eigenaarsdata staat in MariaDB en/of in een configbestand **buiten de webroot** met strakke rechten (aansluitend op ADR-0002: alle state in de database). Per OTAP-omgeving een eigen, gescheiden dataset (ADR-0004).

**Aparte provisioning.** Mistral (Integrator/AVG-gatekeeper) provisioneert de data apart van de codedeploy: synthetisch naar T, gepseudonimiseerd naar A, echt+gehard naar P. De echt→pseudoniem-mapping blijft lokaal.

**Harde gate.** Mistrals PII-scan is een blokkerende poort bij T→A en A→P: de build faalt als er echte persoonsgegevens in de diff, de fixtures of het te uploaden artefact zitten.

## Overwogen alternatieven

- **PII in het artefact laten, maar de zip afschermen.** Afgewezen: afscherming is procedureel en breekt bij de eerste fout (zoals nu al gebeurd is); scheiding van code en data is structureel.
- **PII alleen uit `public/` halen, wel in `data/` meeleveren.** Afgewezen: lost publieke serving op maar niet dat elk gedeeld/gearchiveerd artefact nog steeds de volledige lijst bevat.

## Gevolgen

- De deploy krijgt een expliciete, aparte databestap; `scripts/deploy.sh` en de CI-gate worden hierop ingericht.
- Positief: het gedeelde/gearchiveerde artefact is vrij van PII; de blast radius van een gelekte zip is nul.
- **Terugwerkend (fase 1, apart en met voorrang):** bestaande `dist/*.zip` met live-PII opschonen/veilig archiveren buiten de repo, `owners.initial.js` uit de buildoutput halen, serverzijdig de PII buiten de webroot zetten. Valt buiten fase 2-scope maar is een staand risico.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
