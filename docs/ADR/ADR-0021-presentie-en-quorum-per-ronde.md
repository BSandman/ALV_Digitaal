# ADR-0021 — Presentie = login; quorum per ronde met monotone presentie (supersedes ADR-0009)

**Status:** geaccepteerd — **vervangt [[ADR-0009]]**
**Datum:** 12 augustus 2026
**Beslisser:** Bas (domein/juridisch); vastgelegd door Claude (Architect & Validator)
**Context-links:** [[ADR-0009]] (vervangen), [[ADR-0006]] (voorzitter stelt vast), [[ADR-0008]] (exacte rekenkunde), [[ADR-0010]] (niet/te laat = onthouding), [[ADR-0011]]/[[ADR-0018]] (meerderheid per VvE), [[ADR-0016]] (auth), [[ADR-0022]] (machtiging/stemformulier). De vergadering loopt via Zoom; deze app ondersteunt presentie en de stemrondes.

## Context

ADR-0009 legde het quorum vast als één **vergadering-brede, bevroren** vaststelling zonder herberekening per ronde. Bij het uitwerken van de digitale flow (Zoom + magic-link) bleek een verfijning nodig: laatkomers moeten kunnen meetellen voor latere rondes, en vertrekkers mogen het quorum niet laten dalen. Dit vervangt ADR-0009, **zonder** terug te vallen op de oude fout (quorum uit uitgebrachte stemmen — dat blijft verboden).

## Besluit

1. **Presentie = login.** Een QR-scan of magic-link-klik (ADR-0016) registreert de eigenaarstitel als **present**. Presentie is een juridische registratie op titel-niveau, met breukdeel en VvE bekend.

2. **Presentie telt monotoon (niet-dalend).** Zodra een titel present is — of een machtiging/stemformulier is verwerkt (ADR-0022) — telt dat gewicht mee in de quorumgrondslag voor de **rest** van de vergadering. **Vertrekken/uitloggen verlaagt het quorum niet**; de uitlog-gebeurtenis wordt wél geauditeerd (servertijd-UTC).

3. **Quorum wordt per stemronde vastgesteld**, op het moment dat de admin de ronde **activeert** (op teken van de voorzitter). De grondslag = het gewicht van alle tot dan toe present geregistreerde rechten + verwerkte machtigingen/stemformulieren. Grondslag = **presentie**, nooit uitgebrachte stemmen (blijft de kernregel uit ADR-0009 §2).

4. **Stemgerechtigdheid per ronde = wie op het activatiemoment is ingelogd.** De stemknoppen worden alleen geactiveerd voor titels die op dat moment zijn ingelogd. Wie ná activatie binnenvalt, krijgt **géén** knop voor die ronde — enkel voor rondes die ná zijn login worden geactiveerd. (Combineert met de scope-regel van ADR-0018: knop alleen bij een in-scope recht.)

5. **Present maar niet (tijdig) gestemd, of vertrokken → onthouding** (ADR-0010), en telt nog mee in de quorumgrondslag van die ronde.

6. **Meerderheid ongewijzigd per ronde per VvE** (ADR-0011/0018): 2⁄3 van de geldige stemmen voor, getoetst tegen de quorumgrondslag van díe ronde per betrokken VvE.

## Overwogen alternatieven

- **Bevroren vergadering-breed quorum (ADR-0009).** Vervangen: laatkomers moesten voor latere rondes kunnen meetellen; een strikt bevroren vlag verhindert dat.
- **Quorum laten dalen bij vertrek.** Afgewezen: een eenmaal vastgestelde aanwezigheid blijft juridisch tellen; de stem van de vertrekker valt op onthouding.
- **Quorum uit uitgebrachte stemmen (oude bug).** Blijft afgewezen: grondslag is presentie, niet wie stemt.

## Gevolgen

- **Codex:** de gezaghebbende quorumgrondslag verschuift van de bevroren `meeting_quorum` (ADR-0009) naar een **per-ronde/per-motion** momentopname (`motion.opening_attendance` bestaat al) op basis van de monotone presentieset op activatiemoment. Registreer per ronde de stemgerechtigde set (ingelogd bij activatie). `attendance.present` blijft 1 na vertrek; uitloggen = apart `audit_event`. Exacte decimal-/integerrekenkunde blijft (ADR-0008 §3).
- **Claude:** valideert dat quorum nooit uit uitgebrachte stemmen wordt afgeleid, dat presentie monotoon is, en dat de knop-activatie de activatie-momentopname respecteert.
- **Bas:** de voorzitter geeft per ronde het activatiesein; admin activeert.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
