# Codex-taakpakket — Autorun (ADR-0017)

**Opdrachtgever:** Claude (Architect), namens Bas
**Referentie:** ADR-0017 + ADR-0015 (guardrails) + ADR-0013 (deploy-gates). Onafhankelijke sub-taken; lever elk via het handoff-template. A1 (notifier) heeft prio; het is de veiligheids-/signaallaag.

## A1 — Notifier (`scripts/notify_bas.py`)

- Watcht `handoff.md` (of draait als hook ná elke handoff-wijziging) en stuurt Bas **één** bericht per toestand-overgang bij: `state: BLOCKED`, `action_required_by: bas`, `SPRINT_DONE`.
- **Dedup:** houd de laatst-gemelde `(state, since)` bij in een lokaal state-bestand; niet opnieuw pingen voor dezelfde toestand.
- **Kanaal (pluggbaar):** e-mail als default; optioneel push (ntfy/Telegram/Pushover). Kanaalconfig (SMTP-gegevens / push-token) uit een **lokaal, niet-gecommit** bestand (bijv. `mistral-lokaal/secure/notifier.env` of een pad via env). Nooit in Git.
- **Berichttekst:** de `note` uit de handoff + de state + een directe link/aanwijzing (bv. "druk op Deploy acceptatie" of "approve productie in GitHub").
- Tests: overgang naar elke trigger-state stuurt precies één bericht; herhaalde poll op dezelfde state stuurt niets.

## A2 — Autorun-`act()` + vangrails in `watch_handoff.py`

- Vervang de referentie-`act()`-stub door een **echte runner-aanroep**: voer het rol-specifieke commando uit met de begrensde context (`build_context`) als invoer. Het commando komt uit een **config** (bijv. `autorun.toml`/env per rol), niet hardcoded — Codex vult zijn eigen exec-commando, Claude/Mistral de hunne.
- **Kill-switch / pauze:** vóór elke beurt checkt de watcher een sentinel (`autorun.paused`-bestand of `paused: true` in de frontmatter); is die actief → idle + log, geen actie.
- **Loop-cap:** tel opeenvolgende beurten in de sessie; na `--max-turns` (default 3) of `--max-wallclock` stopt de watcher met een duidelijke melding.
- **Stop-on-error → BLOCKED:** exit-code ≠ 0 van de runner, of een falende state-lint bij de commit → de watcher zet `state: BLOCKED`, `action_required_by: bas`, korte `note`, en stopt (roept de notifier). Geen retry-loop.
- **Idempotentie:** een half afgebroken beurt laat de state op `*_IN_PROGRESS`; bij herstart pakt de rol 'm op of Bas grijpt in. De 60s-guard + Git-coördinatie dekken races.

## A3 — Config + runbook

- `autorun.toml` (of env) met per rol het runner-commando, de loop-cap-defaults en het notifier-kanaal.
- Korte runbook-sectie in `AGENTS.md`: hoe start je de begeleide autorun (`watch_handoff.py --role <rol> --autorun`), hoe pauzeer/kill je 'm, en de attended-first-regel (ADR-0017 §4).

## A4 — Meekijk-laag (observability)

Headless mag geen blinde vlek worden; alle zicht via duurzame artefacten.

- **`status.ps1` verrijken:** toon of de autorun draait/gepauzeerd is, de loop-teller/laatste-beurt-tijd, en de check-status van open PR's (`gh pr status`/`gh run list` indien beschikbaar) naast de bestaande handoff-state/branch/commits/progress-tail. Blijft één-commando + geschikt voor een `while`-lus.
- **Autorun-activiteitenlog:** de watcher(s) + notifier appenden per beurt één regel (`tijd · rol · state → next · uitkomst`) aan een lokaal `autorun.log` (gitignored) — chronologisch spoor voor "wat gebeurde er vannacht".
- **`AGENTS.md`-sectie "Meekijken":** kort overzicht — `status.ps1` (lokaal), GitHub (Actions/PR's/commits/handoff op main), de notifier (push bij uitzonderingen), en het activiteitenlog.

## Definition of done

- A1/A2/A3/A4 gebouwd, getest, door Claude gevalideerd tegen ADR-0017.
- Een **begeleide** droogloop: de keten doorloopt minstens één volledige beurt-overgang autonoom, met de kill-switch aantoonbaar werkend en één notifier-bericht bij een `action_required_by: bas`-overgang.
- Human deploy-gates aantoonbaar intact (de autorun zet `action_required_by: bas` i.p.v. zelf te deployen).

## Buiten scope

Onbemand-overnight aanzetten (expliciete latere Bas-stap na een paar begeleide cycli) · wijzigingen aan de deploy-workflows zelf (ADR-0013 blijft).
