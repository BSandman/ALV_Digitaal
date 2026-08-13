# Codex-taak — Sprint 6: rol-runners voor autorun (ADR-0019)

Doel: alle benodigde autorun-runners opleveren zodat een begeleide droogloop (`--max-turns 1`) een echte beurt draait. Contract en ontwerp: **ADR-0019**; harness: `scripts/watch_handoff.py` (`act`, `verify_completed_turn`, `execute_autorun_turn`).

## Runner-contract (moet gehaald worden)

Elke runner leest de begrensde context van **stdin**, voert **één** rolbeurt uit volgens het AGENTS-overdrachtsprotocol, en eindigt met:

- `handoff.md` geldig én naar de volgende `READY_FOR_<next>` (of `BLOCKED`) — niet op `*_IN_PROGRESS`, state gewijzigd;
- een nieuwe regel in `progress.md`;
- **alles gecommit én gepusht**: `git status --porcelain` leeg en `HEAD...@{u}` = `0 0`;
- exitcode **0**.

Nooit deployen; voor menselijke deploy `action_required_by: bas`. Respecteer de kill-switch (procesboom mag afgebroken worden; beurt hervatbaar).

## A — Mistral integrator-runner (nieuw, deterministisch)

`mistral-lokaal/scripts/run_integration_turn.mjs` (Node 20), aanroepbaar als `ALV_AUTORUN_MISTRAL_ARGV = ["node","mistral-lokaal/scripts/run_integration_turn.mjs","--stdin"]`:

1. Lees de context van stdin (alleen als informatie; besluitlogica is deterministisch, niet LLM-gestuurd).
2. Voer de vaste integratiestappen uit die bij de sprint horen (bv. datasets verversen via de bestaande `gen_synthetic.mjs`/`pseudonymize.mjs`, `pii_scan` draaien) — idempotent; geen echte PII in T/CI (ADR-0004/0005).
3. Ollama/Mistral **uitsluitend** binnen die bestaande scripts voor vervangnamen; **nooit** voor git/handoff/control-flow.
4. Schrijf een `progress.md`-regel, zet `handoff.md` op de juiste volgende `READY_FOR_<next>` met korte `note`, `git add/commit/push`.
5. **Deploy nooit**; als een deploy nodig is: `action_required_by: bas` + stop.
6. Exit 0 bij succes; bij een fout non-zero (watcher zet dan `BLOCKED`).

## B — Codex-runner wiren + verifiëren

- Zet `ALV_AUTORUN_CODEX_ARGV = ["codex","exec","-"]` in het voorbeeld; bepaal en documenteer de exacte non-interactieve/auto-approve-vlaggen zodat één beurt zonder mens commit+pusht en schoon/in-sync eindigt.

## C — Claude-runner wiren + verifiëren

- `ALV_AUTORUN_CLAUDE_ARGV` = Claude Code CLI in print-/headless-modus, prompt van stdin, met een permission-modus die edits + git toestaat zonder interactieve prompt. Dekt de **validatiebeurt** (`READY_FOR_VALIDATION`). Documenteer de exacte vlaggen.

## D — Config, runbook, gitignore

- Werk `mistral-lokaal/autorun.config.example.ps1` bij met de drie concrete ARGV-voorbeelden (Gemini bewust afwezig).
- Vul de runbook in `AGENTS.md` aan met "eerst runnercommando los testen" per rol.
- `secure/` blijft gitignored; geen secrets in voorbeelden.

## Acceptatiecriteria / tests

1. **Contracttest per runner-vorm** (droge run met een gecontroleerde repo-fixture): runner die correct afsluit → `verify_completed_turn` slaagt; runner die niets wijzigt / op `IN_PROGRESS` blijft / ongecommit laat / niet pusht → `AutorunError` (watcher `BLOCKED`).
2. **Geen deploy:** test dat de Mistral-runner geen deploy-pad aanroept en bij een deploy-behoefte `action_required_by: bas` zet.
3. **Determinisme Mistral-runner:** dezelfde input → dezelfde bestandsuitvoer (Ollama alleen in de reeds-deterministisch-omkaderde naamstap).
4. **Gemini verboden:** geen `ALV_AUTORUN_GEMINI_ARGV`; watcher weigert rol `gemini` lokaal (bestaande test blijft groen).
5. **`npm run check` + Python-tests + gates + Gemini-review groen.**

## Overdracht

`handoff.md` → `READY_FOR_TEST` (PR openen; Gemini-review + gates), daarna `READY_FOR_VALIDATION` voor Claude. Baton nu op `READY_FOR_INTEGRATION` (mistral) → moet door Bas/Codex naar `READY_FOR_DEV` (codex) worden gezet om deze sprint te starten (BAS_INTERVENTION-herplan).
