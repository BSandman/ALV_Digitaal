# sprint.md — Sprint 2: Hardening (stemlogica correct & veilig)

**Doel:** de skeleton-stores worden echte, correcte en veilige stemverwerking. De validatie-acties uit `docs/gates/Claude-validatie-sprint1.md` + de domeinregels uit ADR-0008 worden gebouwd, getest en gevalideerd. **10.3 (A-domein) volgt in Sprint 3** — Acceptatie pas ná gevalideerde hardening.

**Sprintversie:** app `v0.2.0` (nieuwe functionaliteit op v0.1.0). Achtergrond in `bijbel.md`; besluiten in ADR-0002/0006/0008.

## Cadans — vier blokken (operating model in `AGENTS.md`)

| Blok | Rol | Watcher | Inhoud |
|---|---|---|---|
| 1 | **Codex** (dev) | `--role codex` | Merge PR #1 → `main`; branch `feat/sprint-2-hardening`; A1–A6; open PR |
| 2 | *auto* | — (serverless) | CI-gates + Gemini-review draaien op de PR |
| 3 | **Claude** (validatie) | `--role claude` | Toets A1–A6 tegen ADR-0002/0006/0008; verwerk Gemini-punten |
| 4 | **Mistral** (integratie) | `--role mistral` | M1: datasets met multi-VvE + machtiging; PII-gate schoon |

Bas (parallel, elk moment): **B1** — machtiging-vervalt-bij-login opnemen in de voorwaarden/instructie-tekst.

## Scope per rol

**Codex (dev) — A1 t/m A6:**
- **A1** Row-level autorisatie: een recht mag alleen gestemd/gelezen door de ingelogde eigenaarsgroep, server-side (vervangt de TODO in `recordVote`/`getCurrentVote`).
- **A2** `NO_BACKSLASH_ESCAPES` toevoegen aan `DB_SESSION_SQL_MODE`.
- **A3** Exacte rekenkunde: vervang `computeResultPlaceholder`'s `Number()`-sommatie door exacte decimal-/SQL-aggregatie (`SUM(weight)`); ronden alleen voor weergave; drempels tegen exacte totalen (ADR-0008 §3). Roep hier de geïsoleerde, met regressietests vastgepinde VvE-rekenkern aan.
- **A4** Auth-hardening: rate limiting per IP én credential, lockout/backoff, apparaatbinding (één actieve sessie), entropie + serverzijdige hash op het codedeel.
- **A5** Machtiging vervalt onherstelbaar bij login van de eigenaar, geauditeerd (servertijd-UTC) — ADR-0008 §2.
- **A6** Sluiting met server-relatieve aftelling (resterende seconden, geen absolute eindtijd). De sluiting blijft één servermoment voor iedereen.
- **A7** (uit validatie, ADR-0009) Quorummodel corrigeren: vergadering-breed en éénmalig door de voorzitter vastgesteld (grondslag aanwezigen + machtigingen), bevroren; haal quorum uit `calculateVoteResult` (behoud meerderheid). Op de PR #2-branch, vóór merge.

**Gemini (test) — G1 t/m G5:** multi-VvE `{PG,TF}`/`{PG,NB}` (niet samenvoegen); machtiging-conflict (login doet machtiging vervallen, dubbel stemmen onmogelijk); load met gespreide aankomst; quorum/2⁄3 exact op de grens; brute-force op de toegangscode.

**Mistral (integratie) — M1:** synthetische (T) en gepseudonimiseerde (A) datasets bevatten de multi-VvE-combinaties en machtiging-scenario's; lokale denylist bijhouden; PII-gate schoon. Geen deploy deze sprint.

## Definition of done

- A1–A6 geïmplementeerd en door Claude **groen** gevalideerd tegen ADR-0002/0006/0008.
- Gemini-review op de PR verwerkt; G1–G5-tests groen met bewijs.
- Exacte-rekenkunde-tests op quorum/2⁄3-drempels groen; machtiging-vervalt-test groen.
- Datasets met multi-VvE klaar (M1); PII-gate groen.
- App getagd `v0.2.0`; `handoff.md` op `SPRINT_DONE`.

## Buiten scope

10.3 A-domein (Sprint 3) · echte productie-deploy · digitaal machtigingsbeheer (blijft buiten, v0.1.0).
