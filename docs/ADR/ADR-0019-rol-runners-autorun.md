# ADR-0019 — Rol-runners voor autorun: contract + Codex/Claude via CLI, Mistral als deterministisch integrator-script

**Status:** geaccepteerd
**Datum:** 12 augustus 2026
**Beslisser:** Bas (go voor "alle runners"); vastgelegd door Claude (Architect & Validator)
**Context-links:** [[ADR-0015]] (deterministische guardrails, geen LLM-in-de-lus voor besluiten), [[ADR-0017]] (autorun: watcher-act, vangrails, deploy blijft mens), `AGENTS.md` (overdrachtsprotocol, rollen), `scripts/watch_handoff.py` (`act`/`verify_completed_turn`).

## Context

De autorun-harness (ADR-0017) roept per rol een **runnercommando** aan uit `ALV_AUTORUN_<ROLE>_ARGV`. Tot nu toe was geen enkele runner ingevuld, dus er kan geen begeleide droogloop draaien. Gemini blijft serverless (GitHub Action) en krijgt **nooit** een lokale runner. Voor Codex, Claude en Mistral leggen we het runner-contract en de invulling vast.

## Het runner-contract (afgeleid uit `watch_handoff.py`)

De watcher start het commando met `subprocess.Popen`, `cwd` = repo, en levert de **begrensde context op stdin** (instructie + volledige `handoff.md`/`sprint.md`/`bijbel.md` + staart van `progress.md`). Een runner moet in **één** aanroep:

1. De context van **stdin** lezen.
2. Het AGENTS-overdrachtsprotocol voor zijn rol uitvoeren: een `READY`-beurt claimen (of eigen `IN_PROGRESS` hervatten), **alleen** rolwerk doen, een regel aan `progress.md` toevoegen.
3. `handoff.md` naar de volgende geldige `READY_FOR_<next>` zetten (of `BLOCKED`), met een korte `note`.
4. **Alles committen én pushen.**
5. Afsluiten met **exitcode 0**.

`verify_completed_turn` weigert de beurt (→ `BLOCKED` + notifier) als: de handoff ongeldig is, de state **niet** veranderde, de beurt op `*_IN_PROGRESS` bleef staan, er **ongecommitteerde** wijzigingen zijn, of lokaal/upstream **niet in sync** is (`HEAD...@{u}` ≠ `0 0`). De kill-switch (`autorun.paused`) of wandklok breekt de runner-procesboom af; de beurt blijft hervatbaar. **Geen enkele runner deployt**; voor een menselijke deploy zet de runner `action_required_by: bas`.

## Besluit

### 1. Codex-runner = Codex CLI headless

`ALV_AUTORUN_CODEX_ARGV = ["codex","exec","-"]` (Codex leest de prompt van stdin, voert één beurt uit, committeert/pusht als GitSteward). Codex blijft de enige die productcode wijzigt. De exacte non-interactieve/auto-approve-vlaggen worden bij het wiren geverifieerd tegen het contract.

### 2. Claude-runner = Claude Code CLI headless (print-modus)

`ALV_AUTORUN_CLAUDE_ARGV` roept Claude Code non-interactief aan (print-/headless-modus, prompt van stdin), voor de rol **Validator** (`READY_FOR_VALIDATION`). Claude committeert **alleen** zijn eigen handoff-/progress-/doc-bestanden (AGENTS). Exacte vlaggen (o.a. permission-modus die edits + git toestaat zonder prompt) worden bij het wiren vastgelegd. Architectuurwerk vóór een sprint blijft mensbegeleid; de autorun-Claude-runner dekt de **validatiebeurt**.

### 3. Mistral-runner = deterministisch integrator-script (Ollama alleen waar al gebruikt)

De Mistral-runner is **geen** LLM-gestuurde agent maar een **deterministisch script** (Node 20, passend bij de bestaande `mistral-lokaal/scripts/*.mjs`) dat de integrator-beurt (`READY_FOR_INTEGRATION`) uitvoert: vaste stappen (bv. synthetische/gepseudonimiseerde datasets verversen via de bestaande scripts, `pii_scan`, integratiecontroles), daarna `progress.md` + `handoff.md` bijwerken, committen en pushen. **Ollama/Mistral wordt uitsluitend gebruikt voor de reeds bestaande generatieve deeltaken** (vervangnamen in `gen_synthetic`/`pseudonymize`) — **nooit** om control-flow, git-acties of handoff-besluiten te sturen. Dit sluit aan op ADR-0015 (geen LLM-in-de-lus voor beslissingen) en houdt de integratiebeurt reproduceerbaar. **Deploy naar A/P blijft mens** (`action_required_by: bas`), ook al is Mistral formeel de deployer.

### 4. Gemini krijgt geen lokale runner

Blijft GitHub Action op de PR (ADR-0007/0017). `ALV_AUTORUN_GEMINI_ARGV` bestaat niet en de watcher verbiedt het.

## Overwogen alternatieven

- **Mistral als volledige LLM-agent met git-tools.** Afgewezen: onbetrouwbaar en niet-reproduceerbaar voor git/handoff-besluiten; botst met de deterministische guardrails (ADR-0015). Ollama blijft beperkt tot generatieve deeltaken.
- **Eén universele runner voor alle rollen.** Afgewezen: rollen hebben verschillende tooling (Codex CLI, Claude CLI, Node-integrator) en verschillende commit-rechten; één runner verhult dat.
- **Deploy in de Mistral-runner meenemen.** Afgewezen: deploy blijft een menselijke poort (ADR-0013/0017).

## Gevolgen

- **Codex (bouwt):** levert de Mistral integrator-runner (deterministisch Node-script met het stdin→werk→commit+push→handoff-contract), wiret + verifieert de Codex- en Claude-ARGV tegen het contract, werkt `autorun.config.example.ps1` en de runbook bij, en voegt contracttests toe (droge-run/exitcodes, "geen deploy", "eindigt schoon + in sync", Gemini verboden).
- **Claude (valideert):** toetst elke runner tegen dit contract en ADR-0017 vóór een onbemande cyclus.
- **Bas:** vult per rol de lokale `ALV_AUTORUN_<ROLE>_ARGV` in `secure/autorun.config.ps1`; begeleide droogloop pas als de runner(s) tegen het contract groen zijn.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
