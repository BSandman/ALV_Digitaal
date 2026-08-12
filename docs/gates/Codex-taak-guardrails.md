# Codex-taakpakket — Pijplijn-guardrails (prerequisite voor onbemande autorun)

**Opdrachtgever:** Claude (Architect), namens Bas
**Referentie:** ADR-0015. Prerequisite vóór de onbemande autorun. Losse, onafhankelijke sub-taken; lever elk via het handoff-template.

## G1 — State-lint (CI-gate leidend + lokale pre-commit hook)

**Doel:** voorkomen dat een ongeldige `handoff.md` in de historie/`main` belandt, zonder mens-in-de-lus.

- **Validator-script** (bijv. `scripts/lint_handoff.py`, dependency-vrij): leest de frontmatter van `handoff.md` en controleert:
  - `state` ∈ { ARCHITECTUUR, READY_FOR_DEV, DEV_IN_PROGRESS, READY_FOR_TEST, TEST_IN_PROGRESS, READY_FOR_VALIDATION, VALIDATION_IN_PROGRESS, READY_FOR_INTEGRATION, INTEGRATION_IN_PROGRESS, BLOCKED, SPRINT_DONE } (bron: `AGENTS.md`; houd de lijst in één plek).
  - `owner` ∈ { claude, codex, gemini, mistral, bas }.
  - Verplichte sleutels aanwezig: `sprint, state, owner, since, next, action_required_by, blocked, note`.
  - `blocked` is booleaans; bij `state: BLOCKED` moet `action_required_by: bas`.
  - Precies één `owner` (geen lijst), en `since` is een geldige ISO-tijd.
  - Frontmatter sluit correct af (twee `---`), `note` is één regel.
  - Optioneel: state↔owner-consistentie (bv. `READY_FOR_DEV` ⇒ `owner: codex`).
- **CI-gate (leidend):** een job in `ci.yml` die `lint_handoff` draait op elke PR en push naar `main`. Faalt = blokkeert. Kan niet omzeild worden.
- **Lokale pre-commit hook** (`.githooks/pre-commit` + een `make hooks`/`git config core.hooksPath .githooks`): draait dezelfde linter zodat een agent de fout meteen als `stderr` terugkrijgt en zichzelf corrigeert. Bypass (`--no-verify`) mag lokaal; de CI-gate vangt het alsnog.
- **Tests:** geldige handoff = groen; verzonnen state / ontbrekende sleutel / twee owners = rood.

## G2 — Tail-context in de watcher (tokenminimalisatie)

**Doel:** de agent alleen de nodige context voeren, niet de hele `progress.md`-historie.

- Pas `scripts/watch_handoff.py` (en/of de wrapper die de agent aanroept) aan zodat de meegestuurde context bestaat uit: de volledige `handoff.md`, `sprint.md`, en **alleen de laatste N regels** van `progress.md` (default N=15, configureerbaar via `--progress-tail`).
- `bijbel.md` blijft heel meegestuurd of via pointer — **niet** dynamisch versnijden (ADR-0015).
- Documenteer kort in `AGENTS.md` dat progress-context tail-based is.

## G3 — Idempotente infra-provisioning (IaC-lite, SSH)

**Doel:** een omgeving (acceptatie/portaal) herhaalbaar inrichten i.p.v. handmatig klikken; voorkomt de drift van vanavond (`NODE_ENV`, `chmod 600`, ontbrekende sleutels).

- **Script** (bijv. `scripts/provision_env.sh --target acceptatie|portaal`), idempotent, via SSH:
  - Maakt/valideert de mappenstructuur (app-root `.../nodeapp`, `~/secrets`).
  - Schrijft/valideert het secrets-`.env` buiten de webroot met **exact de toegestane sleutels** (`DEPLOY_TARGET, DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, AUTH_PEPPER, TRUST_PROXY`), **zonder `NODE_ENV`**, en zet `chmod 600` als **laatste** stap. Waarden komen uit een lokale, niet-gecommitte bron (bijv. `mistral-lokaal/secure/` of env), nooit uit Git.
  - Valideert de Node-omgeving (nodevenv-pad, Node 20) en of `SECRETS_FILE` klopt.
  - Draait de app-loader-checks droog waar mogelijk (bv. een `node -e` require-test op de entry, om lsnode-compat te bevestigen — ERR_REQUIRE_ASYNC_MODULE-regressie).
- **Niet te scripten via SSH:** het aanmaken van de DirectAdmin Node-app zelf (app-root, startup-file, `SECRETS_FILE`-env, Application mode). Documenteer die handmatige stappen (of, indien beschikbaar, via de DirectAdmin-API) in een korte runbook-sectie.

## Volgorde & afronding

Onafhankelijk te bouwen; G1 heeft de hoogste prioriteit (het is de harde vangrail). Ná deze drie kan de onbemande autorun ontworpen/aangezet worden. Elke sub-taak: PR → gates + Gemini → Claude-validatie.
