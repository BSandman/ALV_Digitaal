# ADR-0007 — Repo-scope en coördinatie-topologie

**Status:** geaccepteerd
**Datum:** 10 augustus 2026
**Beslisser:** Bas; voorgesteld door Claude (Architect & Validator)
**Context-links:** [[ADR-0005]] (PII buiten release), `AGENTS.md`

## Context

De geautomatiseerde pijplijn coördineert via Git + `handoff.md`. Bij het opstarten liep Codex vast (`BLOCKED`): `D:\Bas_en_AIs\VvE_Werk\.git` bleek een **leeg omhulsel** (geen HEAD/config/objects) — VvE_Werk is nooit een echte repo geweest. Bovendien is de agent-topologie gemengd: Codex, Claude en Mistral draaien **lokaal op dezelfde machine** (gedeeld bestandssysteem), Gemini draait in de **cloud** (geen toegang tot die schijf).

## Besluit

**1. Repo-scope = `Platform/ALV_Digitaal`, een eigen repo.** Niet VvE_Werk: die map is een gemengd dossier met PII (o.a. `owners.js`) en niet-gerelateerde stukken en mag niet in versiebeheer (ADR-0005). ALV_Digitaal is zelfstandig, heeft een eigen `.gitignore` en de README als nulpunt. Het lege `VvE_Werk\.git`-omhulsel wordt verwijderd.

**2. Coördinatie-topologie.** De drie lokale agents delen één werkmap en zien elkaars bestanden direct; voor hén is Git vooral historie/rollback, geen transport. Voor cloud-Gemini fungeert een **privé GitHub-repo** (`ALV_Digitaal`, gekozen 10 aug 2026, net als HAOS-Werk) als origin en brug. De repo is **privé** — geen PII (gedekt door `.gitignore`), maar wel intern materiaal (architectuur, deploy-structuur, besluiten).

**3. Gemini via GitHub Actions (niet via connector).** Gemini heeft geen repo-connector; hij draait als **GitHub Action op elke Pull Request** (`.github/workflows/gemini-review.yml`): de Action haalt de PR-diff, stuurt die naar de Gemini-API en plaatst de review als PR-comment. Gevolg voor de flow: de DEV→TEST-overdracht loopt via een **Pull Request** (Codex opent de PR bij `READY_FOR_TEST`), niet via een directe push naar `main`. Randvoorwaarden: repo-secret `GEMINI_API_KEY` (Bas), en een **PII-voorwacht** in de workflow die de job laat falen als de diff persoonsgegevens/runtime-data bevat — want de diff verlaat de repo richting de Google-API; dat is alleen veilig zolang de repo per ADR-0004/0005 uitsluitend synthetische data draagt. Deze Action dekt Gemini's **review** (statische diff-analyse); de **uitvoerende** tests (k6-burst, regressieharnas tegen T) draaien in de T-omgeving — lokaal of later als aparte CI-job.

**4. Steward.** Codex init de repo, opent PR's en beheert branches/merges/tags (bevestigt `AGENTS.md`). Lokale DEV-beurten kunnen al draaien op de lokale repo; de push naar origin + PR volgt bij de TEST-overdracht.

## Overwogen alternatieven

- **VvE_Werk als repo herstellen.** Afgewezen: sleept PII en ongerelateerde dossiers mee (ADR-0005).
- **Lokale bare-repo als enige origin.** Afgewezen: cloud-Gemini kan een lokale bare-repo niet bereiken; een op afstand bereikbare privé-remote is nodig zodra Gemini meedoet.
- **Wachten met alles tot de remote er is.** Afgewezen: Codex' DEV-beurt kan lokaal door; de remote is pas nodig bij de TEST-overdracht. Niet onnodig blokkeren.

## Gevolgen

- Codex voert de repo-init uit in ALV_Digitaal; eerste commit bevat geen PII (gedekt door `.gitignore`, geverifieerd 10 aug 2026: 41 bestanden, geen `owners.*`/secrets).
- Remote-besluit (10 aug 2026): privé GitHub-repo `ALV_Digitaal`. Gemini krijgt directe toegang via zijn GitHub-connector. Bas regelt die connector-toegang vóór de eerste `READY_FOR_TEST`; Codex' DEV-beurt kan al draaien.
- De watcher rootte al op ALV_Digitaal (`scripts/watch_handoff.py`, `parents[1]`); consistent met deze repo-root.
- Later per module een eigen repo (OTAP-opzet §8) blijft mogelijk; dit besluit betreft fase 2 als geheel.
