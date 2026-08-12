# Claude-validatie — Sprint 5 / A3 (autorun-config + attended-first runbook)

**Uitkomst:** GROEN. Getoetst tegen ADR-0017.
**Datum:** 12 augustus 2026 — Claude (Validator).

## Wat is getoetst

1. **Attended-first defaults.** `mistral-lokaal/autorun.config.example.ps1` zet `MAX_TURNS=1`, `MAX_WALLCLOCK=900`, `INTERVAL=45`, `PROGRESS_TAIL=15`. Runnercommando's staan uitgecommentarieerd met "controleer eerst handmatig". Notifier verwijst naar het bestaande `notifier.env`. Geen tokens/wachtwoorden in het voorbeeld.

2. **Harde maxima deterministisch afgedwongen — niet te omzeilen.** `AUTORUN_DEFAULT_ENV` koppelt per instelling een harde bovengrens: interval ≤ 3600 s, progress_tail ≤ 500, max_turns ≤ 20, wallclock ≤ 14.400 s. `load_autorun_defaults` weigert niet-cijferige/negatieve/te grote env-waarden (`validate_numeric_bound`). Dezelfde bound wordt ná argparse óók op de **CLI-overrides** toegepast (watch_handoff.py rond regel 762-775), dus bv. `--max-turns 9999` faalt hard. Geen bypass.

3. **Gemini blijft serverless.** Voorbeeldconfig bevat bewust géén `ALV_AUTORUN_GEMINI_ARGV` (contracttest borgt dit); de watcher verbiedt lokale Gemini-autorun.

4. **Deploy blijft mens + attended.** Runbook-contracttest borgt dat `AGENTS.md` de sleutelzinnen bevat: `--autorun --max-turns 1`, `autorun.paused` (kill-switch), `Ctrl+C`, `attended-first`, `action_required_by: bas` en "Onbemand of overnight draaien blijft uit".

5. **Secrets buiten Git.** `.gitignore` sluit `mistral-lokaal/secure/` uit; contracttest verifieert via `git check-ignore` dat de echte lokale `autorun.config.ps1` en `notifier.env` genegeerd zijn; geen `SMTP_PASSWORD=` in het voorbeeld.

Aansluitend op eerdere validatie (A2/A4, PR #13): kill-switch onderbreekt race-guard én actieve procesboom (Windows Job Object kill-on-close), `IN_PROGRESS` hervatbaar, fout→`BLOCKED`+notifier, runner-hygiëne (ongecommit/niet-gepusht → `BLOCKED`).

## Conclusie & volgende stap

Sprint 5 (Autorun) is inhoudelijk compleet: guardrails (G1-G3) + notifier (A1) + autorun-act/vangrails (A2) + meekijklaag (A4) + config/runbook (A3), alle groen. Aanbevolen vervolg: **begeleide droogloop** (attended, `--max-turns 1`) van één volledige cyclus vóór er ooit onbemand/overnight gedraaid wordt.

Git = Codex (GitSteward): Codex merget de A3-PR en zet de baton door.
