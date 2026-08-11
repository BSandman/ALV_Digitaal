# Claude-validatie — Sprint 2 / PR #2 (Hardening)

**Rol:** Claude — Architect & Validator
**Datum:** 11 augustus 2026
**Onderwerp:** PR #2 (`feat/sprint-2-hardening`, t/m `5ddd8b3`) — A1–A6 + de door Codex gestelde quorumvraag.

## 1. Oordeel: A1–A6 GROEN; één structurele correctie vereist (A7)

Getoetst op de feitelijke code tegen ADR-0002/0006/0008.

- **A1 Row-level autorisatie** — OK. `recordVote` neemt `participantId`, doet `assertOwnerScope` + een server-side JOIN (recht ↔ eigenaar ↔ ronde) onder `FOR UPDATE`. Geen client-side filtering.
- **A2 `NO_BACKSLASH_ESCAPES`** — OK. Toegevoegd aan `SESSION_SQL_MODE`; prepared statements overal.
- **A3 Exacte rekenkunde** — OK, exemplarisch. `vote-result.js` zet DECIMAL(12,4) om naar gehele 1/10.000-eenheden (BigInt); quorum/meerderheid via integer-kruisvermenigvuldiging. Nul IEEE-754. Dit is de norm uit ADR-0008 §3, sterker dan de voorgestelde `round:3`.
- **A4 Auth-hardening** — OK. Geverifieerd client-IP alleen via vertrouwde proxy (`client-ip.js`), credential-hashing (`credential-crypto.js`), rate-limit/lockout en één actieve sessie race-bestendig (`AuthStoreMariaDB`).
- **A5 Machtiging vervalt bij login** — OK. AuthStore lockt, invalideert en audit iedere openstaande machtiging bij login (ADR-0008 §2); VoteStore blokkeert digitaal stemmen bij een nog-actieve machtiging.
- **A6 Server-relatieve sluit-timer** — OK. Ronde met `closes_at`/`remaining_microseconds`; stemmen geweigerd zodra de resterende tijd op is. Client krijgt relatieve tijd.

Testbewijs (Codex): 30/30 unit-/contracttests, MariaDB-integratie, concurrency (50 gelijktijdige stemmen, 0 na sluiting, dubbele sluiting → één resultaat, login/machtigingsrace consistent), k6 0% fouten. Gates A/B + Gemini groen.

## 2. Structurele bevinding — quorummodel (→ ADR-0009, actie A7)

`calculateVoteResult` berekent quorum **per ronde uit de uitgebrachte stemmen** (`present` = som van de keuze-gewichten). Dat is onjuist. Bas' regel (ADR-0009): **quorum is vergadering-breed, wordt éénmalig door de voorzitter vastgesteld vóór de eerste ronde**, met als grondslag **aanwezigen + ingeleverde machtigingen/stemformulieren**, en ligt daarna vast; ín een ronde wordt geen quorum meer bepaald.

**Actie A7 (Codex, op de PR #2-branch, vóór merge):**
- Verplaats quorum naar vergaderingsniveau: schema-staat (vastgesteld ja/nee, grondslag-gewicht, `set_by`/`set_at`, geauditeerd), gezet door een expliciete voorzittersactie op basis van `attendance` + machtigingen.
- Haal de quorumberekening uit `calculateVoteResult`; behoud de meerderheidsberekening. De ronde-uitslag **rapporteert** de bevroren vlag.
- Gekwalificeerde-meerderheid-openstelling toetst tegen dezelfde vergadering-brede grondslag.
- Behoud exacte integerrekenkunde (ADR-0008 §3). Voeg tests toe die het vergadering-brede, bevroren gedrag vastpinnen.
- **Onderdeel van A7 (ADR-0010):** registreer bij sluiting voor elk deelnemend recht zonder geldige tijdige stem een **Onthouding** (geauditeerd). Keuzes = Voor/Tegen/Blanco/Onthouding; Blanco en Onthouding blijven niet-beslissend (meerderheid over voor+tegen). Tests: deelnemer stemt niet → onthouding in de uitslag.

## 3. Routing

A1–A6 zijn goedgekeurd, maar PR #2 bevat de onjuiste quorumlogica. Daarom **niet mergen** vóór A7: Codex vult A7 aan op dezelfde branch, gates + Gemini draaien opnieuw, en de baton komt terug naar Claude voor her-validatie. Daarna merge → Mistral (M1). Baton: `READY_FOR_DEV`, owner Codex.

**Los signaal voor Bas:** mogelijk staat dezelfde quorumfout in fase 1 (ALV-STEM-APP) — apart te verifiëren (ADR-0009 §Gevolgen).
