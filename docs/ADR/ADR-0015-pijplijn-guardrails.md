# ADR-0015 — Pijplijn-guardrails: deterministische validatie i.p.v. extra LLM-revisor

**Status:** geaccepteerd
**Datum:** 12 augustus 2026
**Beslisser:** Bas; voorgesteld/geadviseerd door Claude (Architect & Validator)
**Context-links:** `AGENTS.md` (pijplijnregels), [[ADR-0005]] (PII-scan-gate), [[ADR-0012]] (secrets), [[ADR-0013]] (CD)

## Context

Richting de **onbemande** pijplijn (autorun) zijn er risico's die zonder mens-in-de-lus stil kunnen doorlopen: een agent verzint een ongeldige `handoff.md`-state, breekt de frontmatter, of de gedeelde waarheid drift. Daarnaast groeit de tokendruk (vooral `progress.md`) en is de handmatige mijn.host/DirectAdmin-inrichting fragiel (vanavond bewezen: uren aan `NODE_ENV`, `chmod 600`, startup-file en secrets-drift).

Overwogen is een **extra Mistral-revisor-agent** als controlelaag.

## Besluit

1. **Geen extra LLM-revisor.** Structuur- en syntaxvalidatie is deterministisch werk; een LLM is daarvoor het verkeerde gereedschap (niet-deterministisch, latency, tokenkosten) en werkt averechts op het doel om tokendruk te minimaliseren. LLM's blijven voor het generatieve/semantische werk: **Gemini** (diff-review), **Claude** (domeinvalidatie).

2. **State-lint als guardrail.** Een deterministische validatie van `handoff.md` (en de andere besturingsbestanden) tegen de statemachine: toegestane `state`, verplichte frontmatter-sleutels, precies één `owner`. Uitvoering als **CI-gate (leidend)** — kan niet omzeild worden — plus een **optionele lokale pre-commit hook** voor snelle zelfcorrectie (de agent krijgt de `stderr` terug en herstelt in de volgende poging). Faalt de check → commit/CI geweigerd; de gedeelde waarheid blijft schoon.

3. **Tail-context voor tokenminimalisatie.** De watcher/wrapper voedt de agent alleen de laatste N regels van `progress.md` plus de volledige (korte) `handoff.md`, `sprint.md` en de relevante `bijbel.md`. Niet de hele historie. **De bijbel blijft heel** — bewust kort en pointer-heavy; dynamische sectionering wordt nú niet gedaan (complexiteit + risico dat een agent net de relevante ADR mist).

4. **Idempotente infra-provisioning (IaC-lite).** Een SSH-script dat per omgeving idempotent de mappenstructuur, de secrets-`.env` (juiste sleutels, `chmod 600`, géén `NODE_ENV`, `DEPLOY_TARGET` correct) en de Node-omgeving aanmaakt/valideert. Eén keer aftrappen i.p.v. klikken in het control panel. DirectAdmin-GUI/API-stappen die niet te scripten zijn, worden gedocumenteerd.

## Overwogen alternatieven

- **Extra Mistral-revisor-LLM.** Afgewezen: verkeerd gereedschap voor validatie; token + latency; averechts op het doel.
- **Dynamische bijbel-sectionering.** Afgewezen voor nu: de bijbel is al kort; de complexiteit en het risico op een ontbrekende ADR wegen niet op tegen de winst. Snijden in `progress.md`-historie is de praktische winst.

## Gevolgen

- **Deze drie (state-lint, tail-context, infra-script) zijn prerequisites vóór het aanzetten van de onbemande autorun** — het zijn de vangrails die het veilig maken als er niemand kijkt.
- Codex bouwt ze (zie `docs/gates/Codex-taak-guardrails.md`).
- **Grens (eerlijk):** authorship afdwingen ("alleen Claude schrijft `README.md`/`bijbel.md`") kan een hook niet betrouwbaar, want alle agents committen onder dezelfde git-identiteit. Dat blijft een conventie (`AGENTS.md`), geen hard slot; de state-lint bewaakt de *inhoud*, niet de auteur.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
