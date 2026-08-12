# ADR-0017 — Autorun: onbemande pijplijn met vangrails en signaal-lijn

**Status:** geaccepteerd (ontwerp; Codex bouwt)
**Datum:** 12 augustus 2026
**Beslisser:** Bas; ontworpen door Claude (Architect & Validator)
**Context-links:** [[ADR-0015]] (guardrails: state-lint, tail-context, provisioning), [[ADR-0013]] (CD/deploy-gates), `AGENTS.md`

## Context

De guardrails (G1 state-lint, G2 tail-context, G3 provisioning) staan. Nu de autorun: de watcher moet de agent **écht starten** i.p.v. alleen "AAN ZET" printen, zodat de keten onbemand loopt en Bas **alleen bij een signaal** ingrijpt. Dit mag nooit ongeremd zijn.

## Besluit

1. **Autorun `act()` start de rol-runner.** De watcher blijft de dunne, deterministische poller (Git-poll + 60s race-guard + state-lint-bewaakte commits, ADR-0015). Op de eigen beurt roept `act()` de **rol-specifieke runner** aan met de begrensde context (`build_context`, G2):
   - **Codex** via zijn CLI-exec (non-interactief), **Claude** headless, **Mistral** via zijn lokale scripts/Ollama.
   - **Gemini** blijft serverless (GitHub Action) — geen lokale watcher.
   - De runner doet **één beurt**: werk uitvoeren, `handoff.md` + `progress.md` bijwerken, commit + push. De state-lint (G1) en CI-gates vangen fouten. Elke rol vult zijn eigen runner-commando in via een config, niet hardcoded.

2. **Vangrails (verplicht):**
   - **Kill-switch / pauze:** een sentinel (bijv. `autorun.paused`-bestand of `paused: true` in de handoff-frontmatter) zet **alle** watchers idle. Bas kan altijd direct stoppen.
   - **Loop-cap:** max N opeenvolgende beurten per watcher-sessie (default laag, bijv. 3) én een max-wandklok; daarna stopt de watcher + notify. Voorkomt doorloop-loops en quota-verbranding.
   - **Stop-on-error → BLOCKED:** faalt een runner (non-zero exit, of de state-lint weigert de commit), dan zet de watcher `state: BLOCKED`, `action_required_by: bas` met een korte `note` en stopt. Geen oneindige retry.
   - **Human deploy-gates blijven:** de autorun **deployt nooit zelf**. Bij "klaar om te deployen" zet de pijplijn `action_required_by: bas` + notify; Bas drukt de acceptatie-knop of approve't de productie-deploy (GitHub Environment). ADR-0013 blijft leidend.

3. **Signaal-lijn (notifier):** één `scripts/notify_bas.py`, **exception-based** en **gededupliceerd** (één bericht per toestand-overgang, bijgehouden in een lokaal state-bestand). Vuurt uitsluitend bij:
   - `state: BLOCKED`,
   - `action_required_by: bas` (incl. "klaar voor acceptatie-deploy"),
   - `SPRINT_DONE`.
   Kanaal: **e-mail als default** + optioneel **telefoon-push** (ntfy/Telegram/Pushover) voor away-from-keyboard. Kanaalconfig (SMTP/push-token) in een lokaal, niet-gecommit bestand — nooit in Git. GitHub dekt PR-review + de productie-approval-mail al.

4. **Attended-first.** De autorun start **begeleid** (Bas kijkt mee, lage loop-cap) en gaat pas onbemand-overnight zodra een paar volledige cycli bewezen zijn. De kill-switch blijft altijd binnen handbereik.

5. **Meekijk-laag (observability).** Headless verplaatst zicht naar **duurzame artefacten**, niet minder zicht: `status.ps1` (lokaal live-dashboard), GitHub (Actions/PR's/commits/`handoff.md` op main), de notifier (push bij uitzonderingen) en een chronologisch `autorun.log`. Dit is auditeerbaarder dan de vluchtige app-panelen.

## Overwogen alternatieven

- **Elke agent pingt zelf.** Afgewezen: N agents op dezelfde state = spam. Eén notifier, exception-based.
- **Onbemand-direct zonder attended-fase.** Afgewezen: te risicovol met auto-commit/push en quota.
- **Auto-deploy.** Afgewezen: menselijke go blijft verplicht (ADR-0013).

## Gevolgen

- Codex bouwt: de notifier, de autorun-`act()`-wiring per rol, de pauze/kill-switch, de loop-cap en de config. Zie `docs/gates/Codex-taak-autorun.md`.
- Het geheel wordt eerst **begeleid** gedraaid; unmanned-overnight is een expliciete latere stap van Bas.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
