# Codex-taak — C1/C2 datasetscripts voor Mistral (randvoorwaarde M1)

**Opdrachtgever:** Claude (Architect), namens Bas
**Uitvoerder:** Codex (scaffolden); daarna draait **Mistral** (Bas + Ollama) ze.
**Volgorde:** ná de merge van PR #2 + A8. Dit deblokkeert M1.
**Referenties:** ADR-0004 (T=synthetisch, A=gepseudonimiseerd), ADR-0005 (PII lokaal), ADR-0008 (multi-VvE), ADR-0009 (quorumbasis), ADR-0010 (niet-stemmers). Schema: `infra/mysql/init/01-schema.sql`. Mistral-setup: `docs/Mistral_Lokaal_setup_runbook_v1.0.0.md`.

## Doel

Bouw twee reproduceerbare scripts in `mistral-lokaal/scripts/`, met een lokaal model op `http://localhost:11434` (model `mistral-nemo:latest`, terugval `mistral`). Het model levert **uitsluitend** plausibele NL-namen/variatie; alle structuur en rekenkunde (breukdelen, gewichten, splitsingen) is **deterministische code**, geen LLM.

## C1 — synthetische generator (voor T)

**Uitvoer:** `mistral-lokaal/out/synthetic/owners.synthetic.json`, veldgelijk aan het schema, plus een loader-pad dat aansluit op de bestaande seedroute (`infra/mysql/prepare-seed.mjs` / `02-seed-synthetic.sql`).

Genereer een samenhangende, volledig fictieve vergaderingsset die deze tabellen vult: `participant`, `entitlement` (`splitsing_code`, `weight DECIMAL(12,4)`), `attendance` (`present`), `power_of_attorney` (`meeting_id`, `entitlement_id`, status), en de plaintext toegangscodes (de app/seed berekent zelf de `code_lookup_hash`; pepper blijft buiten DB).

**Moet de volgende scenario's dekken (voor toetsbaarheid):**
- **Multi-VvE (ADR-0008):** eigenaars met rechten in `{PG, TF}` én in `{PG, NB}`; rechten nooit samengevoegd, elk met eigen gewicht.
- **Quorumbasis (ADR-0009):** een mix van aanwezige rechten (`attendance.present=1`), rechten met een ingeleverde machtiging (`power_of_attorney`), en rechten die géén van beide zijn. Een recht dat zowel present als gemachtigd is mag maar één keer meetellen (test op geen-dubbeltelling).
- **Niet-stemmers (ADR-0010):** deelnemende rechten die in een ronde niet stemmen, zodat de auto-onthouding bij sluiting toetsbaar is.
- **Gewichten:** breukdelen die per splitsing sluitend optellen tot het geheel; `DECIMAL(12,4)`.

**Reproduceerbaar:** een `--seed` maakt de dataset deterministisch herhaalbaar.

## C2 — pseudonimisator (voor A)

**Invoer + mapping uitsluitend in `mistral-lokaal/secure/`** (gitignored, verlaat de machine niet). **Uitvoer:** `mistral-lokaal/out/pseudo/owners.pseudo.json` (geen herleidbare PII).

Leid uit de echte lijst een set af met **behoud van structuur, splitsingen en stemgewichten**; maskeer identiteit (naam/adres/e-mail). De echt↔pseudoniem-**mapping is deterministisch** (zelfde eigenaar → zelfde pseudoniem) en blijft in `secure/`. Draai bij voorkeur offline. Het model levert plausibele vervangnamen; de gewichtenwiskunde blijft code.

## PII-discipline (ADR-0005)

Echte data en de mapping staan alleen in `secure/`. C1-uitvoer en de repo bevatten nooit echte PII. `mistral-lokaal/scripts/pii_scan` blijft de gate; voeg C1/C2-uitvoerpaden toe aan de scandekking waar relevant.

## Definition of done

- `node mistral-lokaal/scripts/gen_synthetic.mjs --seed <n>` levert `owners.synthetic.json` die via de T-seedroute in MariaDB 11.8 laadt en de vier scenario's hierboven bevat.
- `node mistral-lokaal/scripts/pseudonymize.mjs` levert `owners.pseudo.json` met behouden gewichten/splitsingen en een mapping die alleen in `secure/` staat.
- Korte runinstructie voor Bas (welke commando's, welke Ollama-check) in de scriptheader of een `mistral-lokaal/README.md`.
- Handoff via het zesdelige template; privacyclassificatie schoon.

## Daarna (M1, Mistral = Bas + Ollama)

Mistral draait C1 → T-dataset, en C2 → A-dataset; bevestigt de PII-gate schoon. Pas dan is M1 afgerond en gaat de baton verder (10.3 A-domein / frontend-sprint volgens Bas' keuze).
