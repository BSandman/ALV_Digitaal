# ADR-0016 — Auth-model digitale eigenaars-app: magic-link-als-QR + code + optionele PIN

**Status:** geaccepteerd (richting; detailuitwerking in de auth-/frontend-sprint)
**Datum:** 12 augustus 2026
**Beslisser:** Bas; ontworpen met Claude (Architect & Validator)
**Context-links:** [[ADR-0006]] (stem bij het recht; code gebonden aan recht+ALV-datum+versie), [[ADR-0009]] (login = digitale presentie), auth-hardening A4

## Context

De eigenaar stemt in fase 2 digitaal, meestal op de eigen telefoon, tijdens een live en tijdgebonden ALV. Auth moet: de stem aan het juiste **appartementsrecht** binden, auditeerbaar zijn, **presentie** vaststellen (ADR-0009), en bruikbaar zijn zonder frictie op het live-moment. Een QR die je moet *scannen* werkt niet single-device (je scant geen QR op je eigen scherm).

**E-mail is een vereiste** (elke eigenaar heeft er één; bron TwinQ; ook de rest van het platform leunt erop). De ALV-uitnodiging gaat **altijd per e-mail** — dit zit al in ALV-STEM-APP (fase 1): per eigenaarsgroep ~3 A4 met agenda, machtigingsformulier en QR. Fase 2 bouwt hierop voort, verzint geen nieuw mechanisme. De QR/token is in fase 1 al **gebonden** aan eigenaarsgroep + ALV-datum + agendaversie + voorstellenversie, is **éénmalig** te verwerken en **vervalt** bij eigenaarcontrole (scanner toont `Oude versie.`).

## Besluit

1. **Primair: persoonlijke magic link, ook renderbaar als QR.** De uitnodiging (per e-mail; e-mail is vereist, printen is een gebruikersoptie) bevat een **token** dat op de telefoon als **tik-link** werkt en op een tweede scherm/afdruk als **QR** te scannen is — één token, geen verplichte scan. Het token is **gebonden** aan de eigenaarsgroep/het recht, de ALV-datum en de agenda-/voorstellenversie (ADR-0006). Inloggen = **digitale presentie** (voedt het quorum, ADR-0009).

2. **Eén multi-purpose uitnodigings-token, consistent met ALV-STEM-APP.** Hetzelfde token/QR bedient drie routes, zoals fase 1 al doet:
   - **digitaal** — tik de link → login in de eigenaars-app (fase 2, stemmen/presentie);
   - **fysiek** — toon/print de QR → gescand op de ALV voor aanwezigheid;
   - **machtiging** — print het machtigingsformulier, vul in en lever in → de QR bindt aan die machtiging (`Persoonsmachtiging` of `Stemformulier`, ALV-STEM-APP).
   Regels uit ALV-STEM-APP blijven leidend: **registratie is éénmalig** per vergaderingscyclus (frontend + backend blokkeren hergebruik), en het token **vervalt** bij eigenaarcontrole/verouderde versie (`Oude versie.`). **Machtiging en digitale login sluiten elkaar uit per recht:** logt de eigenaar digitaal in, dan vervalt een openstaande machtiging onherstelbaar (ADR-0008 §2). Het digitale token vestigt een **herstelbare sessie** voor de vergaderdag (v0.1.0); de presentie-/machtigingsregistratie zelf is de éénmalige actie.

3. **Toegangscode als handmatige fallback.** De code (`huisnummer+…-AAA-111-bb-!`) voor wie de link kwijt is: server-side gehasht (pepper), met rate limiting + lockout + apparaatbinding (A4) en één actieve sessie per credential.

4. **Optionele tweede factor = PIN, geen e-mail-OTP.** E-mail-OTP wordt **afgewezen als per-ronde-drempel**: bezorgvertraging/spam tijdens een live ALV, en als de uitnodiging per mail kwam is het hetzelfde kanaal (geen onafhankelijke factor). In plaats daarvan een **PIN** ("iets dat je weet") naast de link/code ("iets dat je hebt"). De PIN wordt **vanaf het begin in model en proces ingebakken als aanvinkbare optie** — mogelijk niet geactiveerd bij de eerste ALV, maar wel aanwezig zodat aanzetten later geen refactor is. PIN per eigenaar, **gehasht met pepper**, en **roteerbaar** (vergeten → nieuwe uitgeven).

5. **E-mail als bezorgkanaal** (uitnodiging/link), en eventueel voor eerste registratie **buiten** het live-moment — niet als OTP-drempel per stemronde.

6. **Platform-feature "welkomstbrief".** Uitgifte van inlogcodes + de ALV-PIN aan **nieuwe eigenaren**, en het **herhalen/roteren** voor vergeten (geroteerde) PINs. Dit is een beheerproces in het bredere VvE-platform (niet alleen fase 2); de auth-store en de codegeneratie moeten hierop aansluiten.

## Overwogen alternatieven

- **QR met verplichte scan.** Afgewezen: werkt niet single-device.
- **E-mail-OTP als tweede factor per ronde.** Afgewezen: latentie/deliverability op het live-moment; kanaal-redundantie met de e-mailuitnodiging.
- **Alleen de toegangscode.** Afgewezen als enige factor: deels raadbaar (huisnummer); vereist minstens rate limiting + apparaatbinding, en idealiter de PIN als tweede factor.

## Gevolgen

- Schema/auth-store: token-flow (magic link) + code-fallback + een **PIN-veld (gehasht, roteerbaar)** met een **opt-in-vlag** per omgeving/vergadering; presentie gekoppeld aan login (ADR-0009).
- Frontend (auth-sprint): stapsgewijze login (link/QR of code → optioneel PIN), duidelijke fallback, toegankelijk voor niet-digitale eigenaren via papier + proxy (machtiging, ADR-0008/0010).
- Welkomstbrief-generatie als beheerfunctie (codes + PIN uitgeven/roteren).
- E-mail is een harde vereiste (TwinQ-bron); geen paperonly-pad nodig als eerste-klas alternatief, wel printen als gebruikersoptie. Detailuitwerking (token-flow, één-multi-purpose-QR, PIN-opt-in, sessieherstel) in de auth-/frontend-sprint, consistent met ALV-STEM-APP.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
