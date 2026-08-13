# Claude-validatie — Sprint 6 (rol-runners voor autorun)

**Uitkomst:** GROEN. Getoetst tegen ADR-0019 (runner-contract) en ADR-0017 (autorun-vangrails).
**Datum:** 13 augustus 2026 — Claude (Validator).

## Wat is getoetst

**Mistral integrator-runner** (`mistral-lokaal/scripts/run_integration_turn.mjs`) — deterministisch Node-script, geen LLM in de control-flow (ADR-0015/0019). Broncode-review + de contractfixtures (`tests/integration-runner.test.mjs`) bevestigen:

1. **Contract gehaald (happy path):** één beurt → `handoff` op `SPRINT_DONE`/owner `claude`, progress-regel, **werkboom schoon** en **`HEAD...@{u}` = 0/0** (gepusht). Exact wat `verify_completed_turn` eist.
2. **Deploy blijft mens:** `--deploy-required` → `BLOCKED`+`action_required_by: bas`, en de deploy-sentinel wordt aantoonbaar **niet** aangeraakt; `integrationPlan` bevat geen deploy-pad.
3. **Fout = hervatbaar, non-zero:** geweigerde push → exit 1, baton blijft `INTEGRATION_IN_PROGRESS` (hervatbaar), werkboom schoon, geen achtergebleven `.tmp`. In autorun zet de watcher dit door naar `BLOCKED`+notifier.
4. **Begrensde stdin:** >512 KiB wordt geweigerd **voordat** de repo wordt aangeraakt; lege stdin faalt.
5. **Determinisme:** identieke input+tijd → identieke `handoff.md`/`progress.md` (twee runs vergeleken); sync-tellers fail-closed; atomische schrijf met EPERM-retry + tempopruiming.
6. **Sprintnummer dynamisch:** `progressLine` leest het sprintnummer uit de handoff (test met sprint 7 → "Sprint 7", niet 6). Mijn eerdere reviewpunt is hiermee opgelost.

**Runner-wiring** (`autorun.config.example.ps1`, getoetst): drie concrete runners — Codex (`codex exec … --ask-for-approval never --ephemeral`), Claude (`--print --permission-mode dontAsk`, begrensde toolset), Mistral (`run_integration_turn.mjs --stdin`) — en **géén** `ALV_AUTORUN_GEMINI_ARGV`. Runbook-contract (ADR-0017) blijft groen: `--autorun --max-turns 1`, `autorun.paused`, `Ctrl+C`, attended-first, "Onbemand of overnight draaien blijft uit".

## Conclusie

Voldoet aan ADR-0019 plus ADR-0017. Geen blokkerende bevindingen. Aanbevolen vervolg: Codex merget de Sprint 6-PR; daarna **één begeleide droogloop** (rol `mistral`, `--max-turns 1`, Bas kijkt mee) vóór er onbemand wordt gedraaid.
