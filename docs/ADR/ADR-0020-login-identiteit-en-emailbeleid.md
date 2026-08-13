# ADR-0020 — Login-identiteit voor ALV-Digitaal: één eigenaarstitel = één credential, e-mailbeleid + datakwaliteitspoort

**Status:** geaccepteerd
**Datum:** 12 augustus 2026
**Beslisser:** Bas (domein); vastgelegd door Claude (Architect & Validator)
**Context-links:** [[ADR-0014]] (object/eigenaar/breukdeel, TwinQ-bron), [[ADR-0016]] (auth: magic-link-als-QR + toegangscode-fallback + optionele PIN), [[ADR-0008]] (stem hoort bij het recht). Achtergrond: HonigParkeren is een **bewoners**-systeem (1+ bewoners per woning); ALV-Digitaal stemt op **eigenaar**-niveau.

## Context

De stemmer in ALV-Digitaal is de **eigenaar** (appartementsrechttitel uit TwinQ), niet de bewoner. Bij verhuur (NB) of een BV (bijv. Sabio Invest) stemt de eigenaar/verhuurder, niet de huurder. Het platform staat meerdere bewoners per adres toe; voor de ALV wordt per titel **één** eigenaar toegelaten. De bron bevat rijen met 0, 1 of 2 e-mailadressen.

## Besluit

### 1. Eén eigenaarstitel = één credential = één login

Per eigenaarstitel (`participant`) is er **één** credential en dus **één** magic-link-login, **ongeacht** hoeveel objecten die titel houdt (TF+PG, meerdere adressen). Een stel ("De heer en mevrouw Janssen") of een BV is **één** titel → **één** login. De meerdere rechten hangen onder die ene login en worden per in-scope recht gestemd (ADR-0018).

### 2. Eén primaire contact-e-mail per credential

De magic-link (ADR-0016) gaat naar **één primaire** e-mail per credential.

- **Twee e-mails op een bronrij (stel):** admin kiest bij meeting-setup de primaire; **default = de eerst-genoemde**. Blijft één login; de tweede e-mail wordt niet als aparte ingang opgeslagen.
- **Nul e-mails:** de **toegangscode op de welkomstbrief** (ADR-0016) is de ingang. E-mail is dus niet hard vereist voor die enkele rijen; admin kan alsnog een primaire e-mail aanvullen.
- **Alternatieve bezorg-e-mails** (link naar meerdere adressen, zelfde credential) zijn een mogelijke latere deliverability-uitbreiding — **niet nu bouwen**; de code-fallback volstaat.

### 3. Datakwaliteitspoort bij setup

De import (ADR-0014) markeert per titel de e-mailstatus (0 / 1 / ≥2) en toont de bron-`Controle_opmerking`. Bij setup lost de admin dit expliciet op (primaire kiezen, ontbrekende aanvullen) vóór uitnodigingen uitgaan. Geen stille aannames.

### 4. Buiten scope (fase-later platform gebruikersbeheer)

Eén hoofd-inlog per eigenaar met gekoppelde **sub-accounts** voor bewoner-functies (bezoekersparkeren, vaste plek met `aanwezig`-indicatie "jullie plek is bezet") is HonigParkeren-operationeel, een andere populatie (bewoners) en een latere fase. Raakt ALV-Digitaal nu niet.

## Overwogen alternatieven

- **Eén login per persoon/e-mail (stel = 2 logins).** Afgewezen: de stem hoort bij de titel, niet de persoon; twee logins zouden dubbeltelling of verwarring geven.
- **E-mail hard vereist voor iedereen.** Afgewezen: enkele bronrijen hebben geen e-mail; de code-fallback (ADR-0016) dekt dat zonder de titel uit te sluiten.
- **Meerdere bezorg-e-mails per credential nu bouwen.** Afgewezen voor nu: extra aanvalsvlak/complexiteit; latere optionele uitbreiding.

## Gevolgen

- **Codex:** credential blijft 1:1 met `participant`; sla per credential één **primaire contact-e-mail** op als niet-stemattribuut buiten de stemlogica (geen echte PII in T/CI — ADR-0004/0005). Importstap markeert e-mailstatus + `Controle_opmerking`; setup dwingt curatie af vóór uitnodigen.
- **Claude:** valideert dat de stem op titel-niveau blijft en dat 0-e-mail-titels via code-fallback toegang houden.
- **Bas:** kiest bij setup de primaire e-mail bij dubbele en vult ontbrekende aan; welkomstbrief levert code (+ later optionele PIN, ADR-0016).
- Wijziging vereist een nieuwe ADR die deze "supersedes".
