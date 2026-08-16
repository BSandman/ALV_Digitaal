# Codex-taak — Sprint 8: Gemini geeft een formele review, poort eist "groen ÉN approved" (ADR-0023)

Doel: de auto-advance mag pas mergen als er náást groene checks een **expliciete `APPROVED`-review** van Gemini staat. Nu plaatst Gemini alleen een comment; het groene vinkje betekent enkel "review-generatie gelukt". Besluit Bas: groen vinkje **én** approved. Eén sprint.

## A — `.github/workflows/gemini-review.yml`: formele review i.p.v. comment

1. Laat het model afsluiten met een **machine-leesbare verdict-trailer** op de laatste regel: `VERDICT: APPROVE` of `VERDICT: REQUEST_CHANGES` (met korte reden). Ontbreekt/ambigu → behandel als `REQUEST_CHANGES` (**fail-closed**).
2. Vervang de `createComment`-stap door een **formele review** (`pulls.createReview`): `event: APPROVE` bij verdict APPROVE, `event: REQUEST_CHANGES` anders; body = de reviewtekst.
3. PII-voorwacht en API-/modelfouten blijven de job **rood** maken (dan géén review, dus geen approve) — bestaande backoff behouden.
4. De review-auteur is `github-actions[bot]`; leg dat vast zodat de poort daarop kan matchen.

## B — `scripts/check_pipeline_pr.py`: approved verplicht

1. Naast de bestaande poort (groene vereiste checks, fork-weigering, base=main, pipelinebranch, mergebaar) nu **verplicht**: minstens één `latestReviews`-entry met `state == "APPROVED"` van de **verwachte reviewer** (`github-actions[bot]`); anders `noop`.
2. Elke `CHANGES_REQUESTED` (reviewDecision óf een latestReviews-entry) → `noop` (blijft).
3. Controleer dat de namen in `REQUIRED_CHECKS` exact matchen met de echte check-namen (job-namen in `ci.yml` = `Handoff state guardrail`/`gates`, in `gemini-review.yml` = `review`). Corrigeer waar nodig; mismatch mag nooit een onterechte merge geven.

## C — Gedrag bij REQUEST_CHANGES (nu bewust beperkt)

Bij `REQUEST_CHANGES` doet de auto-advance **niets** (fail-safe: baton blijft `READY_FOR_TEST`). **Bekende beperking voor onbemand:** dit stalt stil. Routeren van `REQUEST_CHANGES` → `READY_FOR_DEV` (terug naar Codex) of een notifier-seintje is een **aparte vervolgsprint**; voor de attended proef is de stille stall acceptabel (Bas kijkt mee).

## Tests

1. Groene checks + **APPROVED** aanwezig → `merge`.
2. Groene checks maar **geen** APPROVED → `noop` (dit is precies de nieuwe eis).
3. `REQUEST_CHANGES` aanwezig → `noop`.
4. APPROVED van een **andere** auteur dan de verwachte reviewer → `noop`.
5. Verdict-parsing: ontbrekende/ambigue trailer → `REQUEST_CHANGES`.
6. `npm run check` + Python-tests + gates + Gemini groen.

## Overdracht

PR op `agent/*`-branch → gates + (nieuwe) Gemini-approve → `READY_FOR_VALIDATION` voor Claude. Baton nu op `READY_FOR_TEST` (Sprint 7). Bas/Codex: na de Sprint 7-merge baton op `READY_FOR_DEV` zetten om deze Sprint 8 te starten — of, als Sprint 7 nog niet gemerged is, deze wijziging **in dezelfde PR** meenemen (één geheel).
