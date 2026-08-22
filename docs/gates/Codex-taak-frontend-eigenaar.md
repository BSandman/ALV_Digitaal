# Codex-taak — Sprint 10: Eigenaar-frontend v0.1 (deelnemen-UI, happy path)

Doel: een werkende, door de Node-app geserveerde **eigenaar-UI** bovenop de bestaande API, zodat een eigenaar op T (en later A) kan **inloggen (code-fallback) → de open ronde zien → Voor/Tegen stemmen → bevestiging zien**, met polling volgens ADR-0002. Architectuur en scopegrens: **ADR-0024**. Domeinregels: ADR-0011 (alleen Voor/Tegen), ADR-0018 (één actie, server-side fan-out), ADR-0021 (stemknop alleen bij activatie-ingelogd), ADR-0010 (niet/te laat = onthouding). Bestaande API: `app/src/server.js` (`/deelnemen/api/status|login|vote`).

## Referentie — klikbaar prototype (v0.1-milestone, akkoord)

Het klikbare, mobiel-eerst **referentie-prototype** van deze flow (Honigfabriek-huisstijl, gesimuleerde data, door Bas akkoord als v0.1-milestone) leeft in de **pre-stage**: `Platform/_design-prestage/deelnemen/deelnemen-v0.1.html` — bewust buiten de repo, niet in het code-artefact. Gebruik het als **visuele + interactie-referentie** (schermindeling, live-statusstrip, motie-kaart, "u stemt namens …"-fan-out, bevestig-sheet, receipt-scherm). Het is een **referentie, geen productcode**: bouw de echte UI op de bestaande API en de gevendorde tokens; neem geen gesimuleerde data of demo-affordances (thema-/reset-knop, telefoon-frame) over.

**Stem wijzigen tot sluiting.** De eigenaar kan zijn Voor/Tegen **wijzigen zolang de ronde open is** (herhaalde `POST vote` overschrijft de vorige keuze atomair, geen dubbeltelling; de bevestiging toont de huidige keuze met een 'wijzig'-terugweg naar het stemscherm). Het **sluiten/vaststellen** van de ronde doet de voorzitter via de **aparte admin-frontend (tablet/pc-view, latere sprint)** — niet in deze eigenaar-UI.

## Scope (in)

1. **Statische serving in `app/src/server.js`.** Serveer assets onder `/deelnemen/` (index op `/deelnemen/`), buiten `/deelnemen/api/`. Strikte padafhandeling (geen `..`-traversal, canonicaliseer), whitelist content-types (html/css/js/svg/woff2), `Cache-Control` verstandig voor assets; API blijft `no-store`. Onbekend pad onder `/deelnemen/` → de app-shell (of 404 voor assets). Geen framework, geen nieuwe runtime-dependency.
2. **Eigenaar-frontend `app/public/deelnemen/`** (vanilla HTML/CSS/JS, no-build): 
   - **Login-scherm** met code-fallback (`POST /deelnemen/api/login`, body `{code, deviceBinding}`); duidelijke fout-UX bij `AUTH_INVALID/AUTH_LOCKED/AUTH_RATE_LIMITED` (toon `Retry-After`). Sessietoken **alleen in geheugen** (JS-var), nooit in `localStorage`/`sessionStorage`/cookie.
   - **Wachtscherm/rondescherm** dat `GET /deelnemen/api/status` pollt met `If-None-Match` + **jitter**, 304 respecteert, en **stopt** bij gesloten/vastgestelde ronde of ongeldige sessie.
   - **Stemscherm**: één **Voor/Tegen**-keuze (twee knoppen, ADR-0011); na keuze `POST /deelnemen/api/vote` en bevestiging. Geen blanco/onthouding-knop. Knop alleen actief als de eigenaar stemgerechtigd is voor deze ronde (ADR-0021 §4). De keuze is **wijzigbaar zolang de ronde open is** (herhaalde `POST vote` overschrijft atomair; de ronde sluit de voorzitter via de aparte admin-frontend, niet hier).
   - **Bevestiging + huidige stem** (`GET /deelnemen/api/vote`); toon dat de stem geregistreerd is.
3. **Server-side één-actie-fan-out (ADR-0018).** De client stuurt **één** Voor/Tegen-keuze per ronde; de server fan-out't die over álle in-scope rechten van de eigenaar (eigen breukdeel, per VvE geteld), atomair en row-level (ADR-0002), niet splitsbaar. Als de bestaande `recordVote` per `entitlementId` werkt: voeg een dunne server-laag/endpoint toe die de in-scope rechten van de eigenaar voor de ronde bepaalt en er atomair overheen schrijft. Idempotent bij herhaalde submit (zelfde keuze → geen dubbele/afwijkende registratie).
4. **Toegankelijkheid & mobiel-eerst** (ADR-0024 §6): semantische HTML, `aria-live` voor status/uitslag, focusbeheer, contrast/tikdoelen, NL-taal, werkt zonder muis.
5. **Honigfabriek-huisstijl (verplicht, ADR-0024 §7).** Bouw op de canonieke tokens `Platform/platform-tokens.css` (Archivo + IBM Plex Mono, warme papier/donker-zijvlak/amber, royale afronding, warme schaduwen). **Geen eigen kleuren/fonts hardcoderen.** Hergebruik de fase-1-componentpatronen (`alv_presentie_stemmen_app/app/mijn_host_app/public/styles.css` + `app-ui-overrides.css`): knop-/kaart-/notice-stijl, 44px tikdoelen, mobiel card-tables. Domeincodering behouden: TF=groen / NB=geel / PG=blauw, Voor=groen / Tegen=rood. Norm: `Platform/Platform_Stijlgids_v1.0.0.md`.
6. **Tokens vendoren (verplicht).** `platform-tokens.css` en `Platform_Stijlgids_v1.0.0.md` leven in `Platform/`-root, **buiten deze repo** — bij build/serve dus niet bereikbaar via een `../`-pad. Neem een **kopie** van `platform-tokens.css` op in de app-assets (bv. `app/public/deelnemen/vendor/platform-tokens.css`) en laad die vanuit de UI. Zet bovenin de kopie een herkomst-/versieregel (bron: `Platform/platform-tokens.css` v1.0.0) zodat een latere update traceerbaar is; wijzig de tokenwaarden niet lokaal. Bij een nieuwe stijlgids-versie wordt de vendored kopie ververst (aparte kleine taak).

## Scope (uit — latere sprints, niet bouwen)

Admin-UI (ronde activeren/sluiten/vaststellen, quorum-vaststelling) · magic-link/QR-token-login + PIN (ADR-0016) · gemachtigde-UX + digitale intake (ADR-0022) · sessieherstel na paginaherlaad · meerdere bezorg-e-mails (ADR-0020).

## Architectuurregels (meetlat, ADR-0002)

Geen state buiten de DB; geen permanente verbindingen (polling + ETag/jitter); schrijfacties atomair (`SELECT … FOR UPDATE`); server-side row-level filtering (de client krijgt nooit andermans rechten/stemmen); servertijd-UTC in audit; geverifieerd client-IP via proxyheader. **Geen echte PII in O/T/CI** (ADR-0004/0005); de frontend-assets horen bij het code-artefact.

## Acceptatiecriteria / tests

1. **End-to-end happy path (T, verse MariaDB 11.8.8):** code-login → status-poll ziet open ronde → Voor → bevestiging; `GET vote` toont de geregistreerde keuze; de keuze is **wijzigbaar** zolang de ronde open is (nieuwe `POST vote` overschrijft atomair, geen dubbeltelling). Bewijs reproduceerbaar.
2. **Fan-out klopt (ADR-0018):** een eigenaar met meerdere in-scope rechten (bv. PG + TF) krijgt met één actie op elk recht zijn eigen breukdeel geregistreerd, per VvE geteld, nooit samengevoegd; exact decimal (ADR-0008 §3).
3. **Row-level isolatie:** de status-/vote-responses lekken nooit rechten of stemmen van een andere eigenaar; negatieftest.
4. **Geen token-at-rest:** test/inspectie bewijst dat de sessietoken niet naar `localStorage`/`sessionStorage`/cookie wordt geschreven.
5. **Polling-gedrag:** `If-None-Match` levert 304 bij ongewijzigde status; polling stopt bij gesloten/vastgestelde ronde en bij `SESSION_INVALID`.
6. **Statische serving veilig:** padtraversal (`..`, ge-encodeerd) geweigerd; alleen gewhiteliste content-types; API-routes onaangetast (bestaande 83/… Node-tests blijven groen).
7. **Foutpaden:** verlopen/ongeldige sessie → login; `ROUND_NOT_OPEN` → wachtscherm; lockout/rate-limit tonen `Retry-After`.
8. **Toegankelijkheid:** basis-a11y-check (semantiek, focus, `aria-live`) groen; werkt zonder muis op mobiel formaat.
9. **Huisstijl:** de UI gebruikt de **gevendorde** `platform-tokens.css` (geen gehardcodeerde kleuren/fonts, geen `../`-pad buiten de repo), draagt de Honigfabriek-look (Archivo/amber/warme papier) en de domeincodering (TF/NB/PG, Voor/Tegen); visueel consistent met de fase-1 ALV-app. De vendored kopie draagt een herkomst-/versieregel.
10. **`npm run check` + Python-tests + architectuur-, release-, handoff- en PII-gates + Gemini-review groen.** Geen deploy.

## Versie

Eerste eigenaar-UI = major/nieuwe-functionaliteit-stap. Richt op release-tag **v0.1.0** (herstelbare sessie/echte magic-link komen ná v0.1). Exacte tag/branch door Codex als steward; werk op een feature-branch (bv. `feat/sprint-10-frontend-eigenaar`).

## Blok-resolutie (2026-08-22) — PII-false-positive + tokens v1.0.1

De vorige dev-beurt bouwde de frontend, maar de PII-gate blokkeerde **vals** op een viercijferige `px`-maat in het referentie-prototype: de postcode-regex `\d{4}\s?[A-Z]{2}` leest vier cijfers gevolgd door een 2-letter-eenheid als een NL-postcode. Opgelost door het referentie-prototype **uit de repo** te halen (designschetsen horen in de pre-stage, buiten het code-artefact). De app-CSS zelf trok de gate niet.

Nog te doen in de hervatte beurt:
1. **Ververs de vendored tokens naar v1.0.1.** Neem `Platform/platform-tokens.css` (nu v1.0.1 — donkerder `--ink-2`/`--ink-3` voor leesbaarheid) opnieuw over in `app/public/deelnemen/vendor/platform-tokens.css`, met de herkomst-/versieregel op **v1.0.1**. Wijzig geen tokenwaarden lokaal.
2. Draai de gates opnieuw (PII nu schoon) en zet door naar `READY_FOR_TEST`.

**Los, aanbevolen als aparte mini-taak (niet nu):** hard de PII-detector zodat `\d{4}` gevolgd door een 2-letter CSS-eenheid (px/em/ex/ch/vw/vh/cm/mm/pt/pc/in/fr/ms) geen postcode-hit is — anders blokkeert straks ook echte app-CSS met 4-cijferige px. Guardrail-wijziging → met rood/groen-test + Claude-validatie.

## Overdracht

`handoff.md` → open PR bij `READY_FOR_TEST` (Gemini-review + gates), daarna `READY_FOR_VALIDATION` (Claude), dan `READY_FOR_INTEGRATION` (Mistral). Bij een nodige beslissing/afwijking van een ADR: `BLOCKED` + `action_required_by: bas`, of een nieuwe ADR voorstellen via de `note`. **Deploy nooit** in deze sprint.
