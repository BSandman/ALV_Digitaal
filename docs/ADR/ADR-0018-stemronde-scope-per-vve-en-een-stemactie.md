# ADR-0018 — Stemronde-scope per VvE en één stemactie per eigenaar

**Status:** geaccepteerd
**Datum:** 12 augustus 2026
**Beslisser:** Bas (domein/procedureel); vastgelegd door Claude (Architect & Validator)
**Context-links:** [[ADR-0008]] (rechten niet samenvoegen, exacte rekenkunde), [[ADR-0009]] (quorum per vergadering/VvE, bevroren), [[ADR-0010]] (te laat/niet = onthouding), [[ADR-0011]] (in-app alleen Voor/Tegen), [[ADR-0014]] (object/eigenaar/breukdeel). Bron/precedent: ALV-STEM-APP `docs/DESIGN.md` (agenda per punt: `n.v.t.` of "de VvE's waarin wordt gestemd"; gekwalificeerde meerderheid **per betrokken VvE**).

## Context

Er wordt **altijd per VvE (splitsing)** gestemd. Bij het opzetten van een stemronde bepaalt de admin welke VvE('s) op dat agendapunt mogen stemmen. Dit is het digitale equivalent van het fysieke gekleurde stembordje per VvE. Een eigenaar met rechten in meerdere VvE's (bijv. TF + PG) mag zijn keuze binnen één ronde niet splitsen. Anders dan ALV-STEM-APP fase 1 stemt **ALV-Digitaal niet bij acclamatie** — altijd gewogen.

## Besluit

### 1. Ronde-scope = set deelnemende splitsingen

Elke stemronde/agendapunt krijgt bij opzet een **scope**: één of meer VvE's, bijv. `{TF}`, `{NB}`, `{PG}`, `{TF,PG}`, `{NB,PG}`. Een agendapunt zonder stemming is `n.v.t.`. (Schema: `motion.splitsingen` JSON.)

### 2. Stemgerechtigdheid volgt de scope

Een eigenaar is in een ronde stemgerechtigd als hij **minstens één recht** (`entitlement`) houdt waarvan de splitsing in de scope valt. Een eigenaar zonder in-scope recht ziet **geen** stemknop.

### 3. Één stemactie per eigenaar per ronde, gefan-out naar in-scope rechten

De stemgerechtigde eigenaar krijgt **precies één** Voor/Tegen-keuze (ADR-0011), niet één knop per recht. Die ene keuze wordt toegepast op **al** zijn in-scope rechten, elk met zijn **eigen breukdeel**, en **per splitsing** geteld. De eigenaar kan zijn keuze **niet splitsen** over zijn eigen rechten binnen dezelfde ronde (net als het fysieke bordje: één keer omhoog).

- Voorbeeld — eigenaar met TF + PG:
  - Ronde-scope `{TF,PG}` → één knop; de keuze telt in de **TF**-uitslag (breukdeel TF) **én** de **PG**-uitslag (breukdeel PG).
  - Ronde-scope `{PG}` → één knop; telt **alleen** in PG. Zijn TF-aandeel is niet in scope en zegt hier niets.

### 4. Telling, quorum en meerderheid per VvE

De uitslag wordt **per betrokken VvE** bepaald. Gekwalificeerde meerderheid = per VvE ≥ 2⁄3 van het stemgewicht aanwezig/vertegenwoordigd (quorum, ADR-0009) én ≥ 2⁄3 van de geldig uitgebrachte stemmen **voor**. Blanco, onthouding en ongeldig tellen niet in de noemer (ADR-0010). Haalt één betrokken VvE het quorum niet, dan komt het voorstel **niet in stemming** ("Niet in stemming: quorum niet gehaald").

### 5. Geen acclamatie

Elke in stemming gebrachte ronde wordt **gewogen** gestemd; ALV-Digitaal maakt geen automatische acclamatiestem (bewuste afwijking t.o.v. ALV-STEM-APP fase 1).

## Schema-impact

Bij één stemactie schrijft de server **één `vote_revision` per in-scope `entitlement`** van de eigenaar — zelfde `choice`, servertijd-UTC. De fan-out zit op **registratieniveau**; gewichten worden nooit samengevoegd (ADR-0008). Row-level autorisatie blijft per recht (ADR-0002/0008): de eigenaar ziet en beïnvloedt uitsluitend zijn eigen in-scope rechten.

## Overwogen alternatieven

- **Eén knop per recht (aparte keuze per TF/PG).** Afgewezen: wijkt af van de fysieke ALV (één bordje per eigenaar), is verwarrend, en het splitsen van de eigen stem over eigen rechten is juridisch niet nodig.
- **Acclamatie overnemen uit fase 1.** Afgewezen: bewuste beslissing van Bas — ALV-Digitaal stemt altijd gewogen.

## Gevolgen

- **Codex:** stemregistratie als fan-out (één actie → N `vote_revision`); stemgerechtigdheid + knopzichtbaarheid op basis van scope∩rechten; per-VvE quorum-blokkade van niet-openbare voorstellen.
- **Gemini:** tests dekken een TF+PG-eigenaar in scope `{TF,PG}` (twee tallies) én in scope `{PG}` (één tally), een niet-stemgerechtigde (geen in-scope recht → geen knop), en de quorum-blokkade per VvE.
- **Bas:** de agenda-invoer (CSV, ALV-STEM-APP-parity) bevat per punt de VvE-scope.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
