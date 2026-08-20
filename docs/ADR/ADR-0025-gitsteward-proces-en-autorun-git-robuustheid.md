# ADR-0025 — GitSteward als apart deterministisch proces: enige git-schrijver + credential-houder; runners offline

**Status:** geaccepteerd (richting; uitwerking in de git-hardening-sprint)
**Datum:** 19 augustus 2026
**Beslisser:** Bas; ontworpen met Claude (Architect & Validator)
**Context-links:** [[ADR-0007]] (Codex = Git-steward), [[ADR-0017]] (autorun-vangrails), [[ADR-0019]] (rol-runners), [[ADR-0015]] (guardrails). Vervangt de git-delen van ADR-0017/0019 waar die elke runner zelf laten pushen.

## Context

Het leeuwendeel van de autorun-uitval zit op **git**: elke rol-runner doet zijn eigen `pull`/`commit`/`push` in zijn eigen (gesandboxde) omgeving. Dat geeft (a) credential-/sandbox-botsingen — de OS-keyring is onbereikbaar binnen de Codex-sandbox, `.git` niet schrijfbaar, `gh`-token ongeldig; (b) een **dangling working tree** wanneer een runner blokkeert vóór hij kon committen (bv. de losse `progress.md`-BLOCKED-regels die Bas handmatig moest committen); (c) credentials verspreid over drie runners. Veel van deze blokkades vereisen géén inhoudelijke beslissing — puur git-plumbing die een mens nu moet rechttrekken.

## Besluit

1. **GitSteward = apart, deterministisch proces (script, geen LLM).** Eén component bezit álle schrijfacties naar `main` (baton + progress) en is de **enige houder van push-credentials + netwerk** (`GH_TOKEN`, fine-grained PAT uit `secure/`). Pure git-mechanica; geen model, geen tokens-kosten. Analoog aan de Mistral-integrator-runner.

2. **LLM-runners draaien volledig offline-gesandboxed.** Codex/Claude produceren hun wijzigingen en **committen lokaal** op hun werkbranch, en zetten de baton in de werkmap — maar **pushen niet** en hebben **geen credentials/keyring/netwerk** nodig. Daarmee verdwijnt de sandbox-vs-git-botsing structureel en mag hun sandbox juist zo strak mogelijk.

3. **De steward loopt tussen elke stap.** Na elke rol-beurt (succes of blokkade): `pull` → coordination-commit → `push`, met **retry + exponentiële backoff** en **stale-`index.lock`-opruiming**. Transient git (lock, netwerk-hik) lost zo vanzelf op, zonder blokkade.

4. **Block-finalize is verplicht.** Bij élke blokkade commit+pusht de steward de `BLOCKED`-baton + de `progress.md`-regel naar `main`. Gevolg: de working tree blijft schoon en GitHub reflecteert altijd de werkelijkheid. Alleen een git/credential die ná retries écht kapot is, escaleert naar Bas (`action_required_by: bas`).

5. **Alleen coördinatie auto naar main.** De steward pusht automatisch uitsluitend `handoff.md`/`progress.md` naar `main`. **Half-af productcode** blijft op de werkbranch/PR en wordt nooit automatisch naar `main` gemerged (de bestaande PR-gate/auto-advance blijft de enige merge-route).

6. **Sandbox-lijn Codex-runner (interim):** tot de steward er is, draait de Codex-runner `--sandbox danger-full-access` op Bas' vertrouwde lokale machine met `GH_TOKEN`; ná de steward kan die sandbox weer dicht (runner offline). Deploy blijft te allen tijde een menselijke poort (ADR-0013/0017).

## Overwogen alternatieven

- **Elke runner doet eigen git met full-access.** Afgewezen: credentials verspreid, sandbox onnodig open, en block-finalize niet gegarandeerd (dangling tree).
- **GitSteward als gedeelde module in elk runner-proces** (i.p.v. apart proces). Afgewezen: lost credential-isolatie niet op — elk proces heeft dan nog steeds de token nodig.
- **Alles (ook feature-branch-commits + PR) door de steward.** Voor nu niet: de code-commit is de output van de runner; de steward bezit push + main-coördinatie + block-finalize. Verdere centralisatie kan later als het loont.

## Gevolgen

- **Codex:** bouwt de deterministische GitSteward (`scripts/git_steward.py` of `mistral-lokaal/scripts/`-stijl Node), refactort `watch_handoff.py` zodat rol-runners hun git-push aan de steward delegeren en offline kunnen; implementeert retry/backoff, stale-lock-opruiming en de verplichte block-finalize. Tests dekken: block → BLOCKED-baton+progress gecommit+gepusht, transient-git → retry-herstel, echt-kapot → escalatie, geen productcode naar main.
- **Claude:** valideert dat de tree na elke beurt schoon is, GitHub de baton reflecteert, credentials alleen bij de steward liggen en productcode nooit auto naar main gaat.
- **Bas:** vult `GH_TOKEN` in `secure/` (fine-grained PAT: Contents RW, Pull requests RW, Workflows RW, Metadata RO); wordt alleen nog gepingd bij een blokkade die geen git-plumbing is.
- Supersedes de git-uitvoeringsdelen van ADR-0017/0019; de statemachine-namen blijven, er komt een steward-sync-stap tussen de transities.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
