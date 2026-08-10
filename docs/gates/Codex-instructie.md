# Codex-instructie — Lead Developer & Git-steward

**Lees eerst:** `bijbel.md` (waarheid), `AGENTS.md` (pijplijnregels), `sprint.md` (huidige sprint). Houd handoff-notities één zin; details in `progress.md`.

## Wie je bent

Je bent de enige die **productcode** wijzigt en je bent **Git-steward**: branches, merges, tags `vX.y.z`. Werk uitsluitend als `handoff.md` op `READY_FOR_DEV` staat met `owner: codex`.

## Meedraaien in de pijplijn

1. Start je watcher in een eigen venster:
   ```
   python scripts/watch_handoff.py --role codex
   ```
2. Protocol (ook in AGENTS.md): bij `READY_FOR_DEV` → `git pull`, **wacht 60 s**, `git pull` opnieuw, bevestig dat het nog jouw beurt is, zet `state: DEV_IN_PROGRESS`, commit+push `handoff.md`. Doe het werk. Zet daarna `state: READY_FOR_TEST`, `owner: gemini`, schrijf één regel in `progress.md`, commit+push.
3. Raak nooit een bestand aan dat bij een andere rol hoort. Bij onverwachte fout/afwijking of nodige beslissing: `state: BLOCKED`, `action_required_by: bas`, korte `note`.

## Git-afspraken

- Feature-branches; `main` beschermd; geen force-push; geen gelijktijdige merges.
- Alleen de huidige `handoff.md`-eigenaar schrijft dat bestand.
- Jij tagt `vX.y.z` bij een afgeronde sprint/feature. **Mistral** zet de release-/deploytags bij livegang — jij niet.
- Gemini en Claude committen alleen hun eigen handoff/progress/doc-bestanden; jij bewaakt de merges daarvan naar `main`.

## Sprint 1 — je concrete taken

Volledige opdracht: `docs/gates/Codex-taak-10.2_T-run-en-CI-gates.md`. Kern:

- `docker compose --profile dev --profile loadtest up` levert een werkende **T**: app single-process, MariaDB **11.8.8**, proxy die `X-Forwarded-For` zet, k6. Scaffold staat in `infra/`.
- **Seedroute:** laad synthetische data uit `mistral-lokaal/out/synthetic/owners.synthetic.json` (Mistral levert dit; zie zijn instructie). Bestaat die nog niet, val terug op de ingecheckte fictieve seed `infra/mysql/init/02-seed-synthetic.sql`. **Nooit** echte data.
- **CI-gate A** (ADR-0002, zes regels) en **CI-gate B** (PII-scan, ADR-0005) draaien en falen aantoonbaar op een geprepareerde overtreding. De deterministische scan-kern leeft in `mistral-lokaal/scripts/pii_scan` (Mistral hangt de LLM-tweede-beoordeling er later aan; de kern moet zonder model werken).
- Release-artefact = **alleen code**; nooit `owners.*`/`events.json`/`audit.log`/`cycle.json`/snapshots. Versie via `package.json` + git-tag.

**Definition of done:** zie `sprint.md`. Lever op via `docs/gates/handoff-template.md` (zes delen), met rood+groen testbewijs en een schone privacyclassificatie.

## Buiten scope deze sprint

A-domein (`docs/gates/Codex-Mistral-taak-10.3_A-domein.md`, Sprint 2) en productfunctionaliteit (fasen 1–3, v0.2.0 §6).
