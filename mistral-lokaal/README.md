# Lokale C1/C2-datasets

De scripts gebruiken Node.js 20. C1 maakt uitsluitend fictieve T-data; C2 leest echte A-brondata en de lokale mapping uitsluitend uit `secure/`. Zowel `secure/` als `out/` is gitignored.

## C1 — synthetische T-set

Controleer desgewenst eerst Ollama:

```powershell
ollama list
```

Genereer met het lokale model (`mistral-nemo:latest`, terugval `mistral`):

```powershell
node mistral-lokaal/scripts/gen_synthetic.mjs --seed 20260811
```

Voor een volledig offline en byte-reproduceerbare run:

```powershell
node mistral-lokaal/scripts/gen_synthetic.mjs --seed 20260811 --offline
```

`docker compose -f infra/docker-compose.yml up` zet deze JSON automatisch om in seed-SQL, hasht de leesbare toegangscodes en laadt de set in MariaDB 11.8.

## C2 — gepseudonimiseerde A-set

Plaats de echte bron uitsluitend als `mistral-lokaal/secure/owners.real.json`. Draai daarna bij voorkeur offline:

```powershell
node mistral-lokaal/scripts/pseudonymize.mjs
```

De sleutel en deterministische echt↔pseudoniem-mapping ontstaan in `secure/`; de schone uitvoer staat in `out/pseudo/owners.pseudo.json`. Voor alleen vervangnamen uit lokaal Ollama kan `--use-ollama` worden toegevoegd. Structuur en gewichten komen altijd uit deterministische code.

Controleer de uitvoer vóór gebruik:

```powershell
node mistral-lokaal/scripts/pii_scan --path mistral-lokaal/out/pseudo
```
