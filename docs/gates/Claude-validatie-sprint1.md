# Claude-validatie — Sprint 1 / PR #1 (Fundament)

**Rol:** Claude — Architect & Validator
**Datum:** 10 augustus 2026
**Onderwerp:** PR #1 (T-run + CI-gates + skeleton stores), plus consolidatie van de Gemini-review en Bas' aanvullingen.

## 1. Architectuuroordeel: GROEN (met vervolgacties)

Getoetst tegen de zes regels van ADR-0002, op de feitelijke bestanden:

- **State in DB / staatloos proces** — OK. Geen in-memory rondestatus; alles via MariaDB (`pool.js`, stores).
- **Atomair sluiten met `FOR UPDATE`** — OK. `closeRoundAtomically` lockt de ronde, zet `closing → closed`, schrijft onveranderlijk `round_result`, en is idempotent bij herhaald sluiten.
- **Append-only stemmen** — OK. `vote_revision`, laatste revisie per (ronde, recht) telt.
- **Servertijd-UTC** — OK. `UTC_TIMESTAMP(3)`, pool op `timezone 'Z'` + `SET time_zone '+00:00'`.
- **Strikte sql_mode per verbinding** — OK (ADR-0003), zie actie A2 voor aanscherping.
- **Row-level filtering** — **TODO**, correct gemarkeerd in `recordVote` (actie A1).

Gates in `ci.yml`: regressietests, Gate A (arch), code-only release-build, Gate B (`pii_scan` op diff/fixtures/artefact met upload). Dit dekt de DoD van taak 10.2. Skeleton-stores zijn iets vooruit op "geen productcode", maar zuiver als scaffolding met TODO's — akkoord.

## 2. Vervolgacties (consolidatie Gemini-review + Bas)

### Codex (developer)

- **A1 — Row-level autorisatie.** Implementeer de TODO in `recordVote`/`getCurrentVote`: een recht mag alleen worden gestemd/gelezen door de ingelogde eigenaarsgroep, server-side (ADR-0002 r4). Blokkeert horizontale-privilege-lekken.
- **A2 — sql_mode aanscherpen.** Voeg `NO_BACKSLASH_ESCAPES` toe aan de default `DB_SESSION_SQL_MODE` (naast `STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION`). Verkleint het SQL-injectie-oppervlak; blijft binnen de intentie van ADR-0003.
- **A3 — Exacte rekenkunde.** Vervang `computeResultPlaceholder`'s `Number(weight)`-sommatie door exacte decimal-/SQL-aggregatie (`SUM(weight)` in DB). Ronden alleen voor weergave; drempels tegen exacte totalen (ADR-0008 §3).
- **A4 — Auth-detectie versterken.** Toegangscode is deels raadbaar (huisnummer). Voeg server-side rate limiting per IP én per credential toe, lockout/backoff bij herhaalde misser, apparaatbinding (één actieve sessie), en voldoende entropie + serverzijdige hash op het `-AAA-111-bb-!`-deel (ADR-0002 r6).
- **A5 — Machtiging vervalt bij login.** Implementeer de transitie uit ADR-0008 §2: bij authenticeren van de eigenaar vervalt een openstaande machtiging voor dat recht onmiddellijk en onherstelbaar, geauditeerd (servertijd-UTC).
- **A6 — Sluiting met server-relatieve timer.** De ronde-sluiting wordt aangekondigd met een zichtbare aftelling (Kahoot-stijl). De server stuurt **resterende seconden** (relatief), niet een absolute eindtijd, zodat client-klokdrift niet meetelt (zie §3). **Principe:** de sluiting is één servermoment voor iedereen; load-spreiding/batching (G3) raakt de sluittijd nooit — het is uitsluitend load-shaping in de test en poll-jitter. Alles wat daaraan puur cosmetisch is en verwarring geeft: droppen.

### Gemini (tester)

- **G1 — Multi-VvE.** Testdata + tests dekken eigenaars met `{PG,TF}` en `{PG,NB}`; controleer dat rechten niet samengevoegd worden en dat elk recht apart telt (ADR-0008 §1).
- **G2 — Machtiging-conflict.** Test dat login een openstaande machtiging voor dat recht doet vervallen en dat dubbel stemmen onmogelijk is.
- **G3 — Load-vorm.** Model de 120-clients-burst met **gespreide aankomst** (jitter, bv. batches met ~2s-interval) i.p.v. één gesynchroniseerde golf — realistischer én het toetst dat de server een échte gelijktijdige burst atomair aankan (niet als excuus om atomiciteit te versoepelen).
- **G4 — Drempelgevallen.** Quorum en 2⁄3-meerderheid precies op de grens, met exacte gewichten (ADR-0008 §3).
- **G5 — Brute-force.** Negatieftest op de toegangscode: rate limiting/lockout werkt (A4).

### Mistral (data/integratie)

- **M1** — Synthetische (T) en gepseudonimiseerde (A) datasets bevatten de multi-VvE-combinaties (ADR-0008 §1) en machtiging-scenario's.

### Bas (mens)

- **B1** — Neem de machtiging-vervalt-bij-login-regel op in de voorwaarden/instructie-tekst (ADR-0008 §2).

## 3. Antwoord op de klok-sync-vraag

Met servertijd als enige bron (ADR-0002 r5) is het **correctheidsrisico nagenoeg nul**: de server bepaalt open/sluit en stempelt elk event; een stem telt alleen na serveracceptatie terwijl `status='open'` (al afgedwongen via `FOR UPDATE` + statuscheck). Een verkeerde client-klok kan een stem dus niet mis-timen of ten onrechte laten tellen. Er is **geen aanvullend gedistribueerd-klok-ontwerp** nodig; twee concrete maatregelen volstaan:

1. **Server stuurt relatieve tijd** ("resterende seconden"), niet een absolute eindtijd. De client telt daarvan af en hersynchroniseert bij elke poll. Zo raakt client-klokdrift noch de handhaving, noch de zichtbare aftelling (koppelt aan A6).
2. **Hostklok NTP-gesynchroniseerd** — op mijn.host het geval; één keer bevestigen. Audit-tijdstempels blijven allemaal servertijd-UTC.

Kort: de bestaande maatregel is afdoende; alleen "relatieve deadline i.p.v. absolute" toevoegen, verder niets.

## 4. Handoff

Deze acties vormen de kern van **Sprint 2** (samen met 10.3 A-domein). PR #1 kan wat mij betreft mergen; de vervolgacties zijn geen blokkade op het fundament maar de inhoud van de volgende ronde.
