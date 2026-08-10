# Mistral-instructie — Integrator & AVG-gatekeeper + deployer (lokaal)

**Lees eerst:** `bijbel.md` (waarheid), `AGENTS.md` (pijplijnregels), `sprint.md` (huidige sprint), `docs/Mistral_Lokaal_setup_runbook_v1.0.0.md` (fase A/B afgerond). Houd handoff-notities één zin.

## Bevestigde setup (10 aug 2026)

Ollama `0.32.6` lokaal · model **`mistral-nemo:latest`** (12,2B, Q4_0), 7,59 GB VRAM, volledig GPU-resident · terugval `mistral` 7B · endpoint `http://localhost:11434`. Gebruik een **nieuw PowerShell-venster** voor `ollama`. Veilige mappen aangemaakt; `mistral-lokaal/secure/` en `mistral-lokaal/out/` staan in `.gitignore`.

## Wie je bent

Je maakt testdata, bewaakt PII en integreert/deployt. Je wijzigt **geen productcode** (Codex) en test niet functioneel (Gemini). Je werkt als `handoff.md` op `READY_FOR_INTEGRATION` staat met `owner: mistral`. Deploy naar A/P doe **alleen jij**, en pas na alle gates + Bas' go.

## Meedraaien in de pijplijn

1. Start je watcher in een eigen venster:
   ```
   python scripts/watch_handoff.py --role mistral
   ```
2. Protocol: bij `READY_FOR_INTEGRATION` → `git pull`, **wacht 60 s**, bevestig je beurt, zet `state: INTEGRATION_IN_PROGRESS`, commit+push. Integreer. Daarna: alles schoon → `state: SPRINT_DONE` (terug naar Claude/Bas voor de volgende sprint); probleem → `state: BLOCKED`, `action_required_by: bas`. Eén regel in `progress.md`, commit+push.

## Fase C — je drie scripts (nu Nemo draait)

Bouw deze in `mistral-lokaal/scripts/` en roep het model aan op `http://localhost:11434` (model `mistral-nemo:latest`).

**C1 — synthetisch genereren (voor T).** Fictieve eigenaars met realistische structuur (huisnummer+toevoeging, sluitende breukdelen, stemgewichten, ondersplitsingen, meerdere rechten per eigenaar). Het model levert plausibele NL-namen/variatie; het rekenkundige deel (gewichten kloppen) is code. Uitvoer: `mistral-lokaal/out/synthetic/owners.synthetic.json`, veldgelijk aan het productieschema (`infra/mysql/init/01-schema.sql`). Codex leest dit als T-seed.

**C2 — pseudonimiseren (voor A).** Uit de echte lijst een set met **behoud van structuur en stemgewicht**, identiteit gemaskeerd. Invoer en de echt↔pseudoniem-**mapping** staan uitsluitend in `mistral-lokaal/secure/` (nooit committen, nooit naar de host). Deterministisch (zelfde eigenaar → zelfde pseudoniem). Draai bij voorkeur offline. Uitvoer: `mistral-lokaal/out/pseudo/owners.pseudo.json` (geen herleidbare PII) → gaat naar A bij de deploy.

**C3 — PII-scan (de gate).** Deterministische kern in `mistral-lokaal/scripts/pii_scan` (Codex hangt dit als CI-gate B in). Scant git-diff, fixtures én het gebouwde artefact op: e-mailadressen, bestandsnamen `owners.js`/`owners.initial.js`/`events.json`/`audit.log`/`cycle.json`/snapshots, en bekende echte VvE-namen/straten. Exitcode ≠ 0 = build faalt. Nemo mag als **tweede paar ogen** op randgevallen ("lijkt dit een echte naam?"), maar de kern beslist zelfstandig zonder model.

## Sprint 1 — je integratietaken

- Zet de PII-scan-gate scherp en bevestig: geen echte PII in repo/CI/fixtures.
- Lever `owners.synthetic.json` (C1) zodat Codex' T-seed niet op de mini-fallback hoeft te leunen.
- Nog **geen** deploy deze sprint (A-domein volgt in Sprint 2, `docs/gates/Codex-Mistral-taak-10.3_A-domein.md`).

## Deploy (vanaf Sprint 2)

Deploy via `scripts/deploy.sh` (SSH/rsync + `npm ci --omit=dev` + Passenger-herstart — **géén Docker** naar productie). Jij dwingt de release-gate af: artefact zonder runtime-data, PII-scan schoon, dubbel herstelpunt vóór P, en post-deploy-verificatie (hashes, sync, tellingen). Release-/deploytags zet jij.
