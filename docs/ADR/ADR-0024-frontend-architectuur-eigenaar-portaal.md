# ADR-0024 — Frontend-architectuur eigenaar-portaal: vanilla, no-build, door Node geserveerd, in-memory sessie, polling

**Status:** geaccepteerd (richting; eerste uitwerking in Sprint 10)
**Datum:** 18 augustus 2026
**Beslisser:** Bas (eigenaar); ontworpen met Claude (Architect & Validator)
**Context-links:** [[ADR-0002]] (zes shared-hosting-regels: polling + ETag/jitter, row-level, servertijd), [[ADR-0011]] (in-app alleen Voor/Tegen), [[ADR-0016]] (auth: magic-link/QR + code-fallback + optionele PIN; herstelbare sessie v0.1.0), [[ADR-0018]] (één stemactie per ronde, server-side fan-out), [[ADR-0021]] (presentie = login; stemknop alleen bij activatie ingelogd), [[ADR-0022]] (machtiging/stemformulier — UX geparkeerd), `Platform/Platform_Stijlgids_v1.0.0.md` + `Platform/platform-tokens.css` (huisstijl). Backend-API bestaat al: `/deelnemen/api/status|login|vote`.

## Context

Sprints 1–9 leverden de geharde backend, synthetische datasets, de acceptatie-deploy (live op `acceptatie.honigfabriek.nl`) en de volledige pijplijn-automatisering. Er is nog **geen scherm**: de eigenaar kan niet inloggen, de open ronde niet zien en niet stemmen. Dit is het eigenlijke Fase-2-product. Deze ADR legt de frontend-architectuur vast vóór de eerste UI-sprint, zodat latere schermen (admin, gemachtigde) op dezelfde leest schoeien.

## Besluit

1. **Vanilla HTML/CSS/JS, geen buildstap, geen SPA-framework.** Consistent met fase 1 (`alv_presentie_stemmen_app`) en met de shared-hosting/Passenger/lsnode-realiteit (ADR-0001/0002). Geen bundler, geen transpiler, geen npm-frontenddeps. Reden: minimale aanvalsvlakte, geen build-gate in de pijplijn, triviaal te serveren en te auditen. Progressive enhancement; werkt op een gemiddelde telefoon zonder moderne-JS-luxe.

2. **De Node-app serveert de statische assets** onder `/deelnemen/` (buiten `/deelnemen/api/`). Geen aparte webserver/CDN. Statische routing met strikte padafhandeling (geen traversal), correcte content-types en verstandige cache-headers; de API blijft `no-store`. De assets horen bij het **code**-artefact (nooit PII — ADR-0005).

3. **Sessiestatus alleen in het geheugen.** De sessietoken (Bearer, ADR-0016 §3 / auth-hardening A4: één actieve sessie per credential) leeft in een JS-variabele, **nooit** in `localStorage`/`sessionStorage`/cookie-JS. Paginaherlaad = opnieuw inloggen in v0.1 (de "herstelbare sessie" uit ADR-0016 is een expliciete latere verfijning, niet nu). Reden: geen token-at-rest op een gedeeld/geleend toestel op het live-moment.

4. **Polling met ETag + jitter** voor de rondestatus (ADR-0002: geen permanente verbindingen). De client pollt `/deelnemen/api/status` met `If-None-Match`, respecteert 304, voegt jitter toe om kudde-effecten te vermijden, en **stopt** met pollen zodra de ronde gesloten/vastgesteld is of de sessie ongeldig wordt.

5. **In-app alleen Voor/Tegen (ADR-0011), één stemactie (ADR-0018).** De eigenaar ziet één Voor/Tegen-keuze per ronde; de **server** fan-out't die keuze over al zijn in-scope rechten (eigen breukdeel, per VvE), niet splitsbaar. Blanco/onthouding zijn geen knoppen — alleen resultaat. Onthouding wordt afgeleid (niet/te laat gestemd = onthouding, ADR-0010). De stemknop is alleen actief voor wie op het activatiemoment is ingelogd (ADR-0021 §4).

6. **Toegankelijkheid & mobiel-eerst.** Semantische HTML, focusbeheer, voldoende contrast en tikdoelen, `aria-live` voor status-/uitslagupdates, werkt zonder muis. Nederlands als taal. Duidelijke fallback-UX (code-login) voor wie de magic-link kwijt is.

7. **Visuele stijl = Honigfabriek-huisstijl (verplicht, platformbreed).** De frontend ademt exact de bestaande huisstijl van honigfabriek.nl / de fase-1 ALV-app / HonigParkeren: warme papier-achtergrond, donker zijvlak, honing-amber accent, **Archivo** (UI) + **IBM Plex Mono** (technische data), royale afronding, warme schaduwen. Codex bouwt op de **canonieke tokens** (`Platform/platform-tokens.css`), hardcodeert geen eigen kleuren/fonts, en hergebruikt de fase-1-componentpatronen. De ALV-domeincodering blijft functioneel herkenbaar: TF=groen / NB=geel / PG=blauw, Voor=groen / Tegen=rood. Norm: **`Platform/Platform_Stijlgids_v1.0.0.md`**. Dit is meteen de platform-stijl voor latere onderdelen.

8. **Scopegrens v0.1 (deze eerste UI-sprint).** In: eigenaar-deelnemen-flow (login → open ronde zien → Voor/Tegen → bevestiging) tegen de bestaande API, met code-login als ingang. Uit (latere sprints): admin-UI (ronde activeren/sluiten/vaststellen, quorum), magic-link/QR-token-login en PIN (ADR-0016), gemachtigde-UX en digitale intake (ADR-0022), sessieherstel na herlaad.

## Overwogen alternatieven

- **React/Vue-SPA met buildstap.** Afgewezen: bouwcomplexiteit, build-gate en frontend-dependencyketen wegen niet op tegen de baat voor een compacte, tijdgebonden stem-UI; wringt met de no-PII/eenvoud-lijn van shared hosting.
- **Aparte statische host/CDN voor de frontend.** Afgewezen voor nu: extra CORS-, deploy- en domeinoppervlak; de Node-app serveert de assets prima onder hetzelfde origin.
- **Sessietoken in `localStorage` voor herlaad-persistentie.** Afgewezen: token-at-rest op mogelijk gedeelde toestellen; botst met één-actieve-sessie (A4). Herstelbare sessie komt later, server-gestuurd.

## Gevolgen

- **Codex:** voegt statische serving toe aan `app/src/server.js` (veilige paden, content-types, cache-headers; API-routes onverlet) en bouwt de `/deelnemen/`-assets **op `Platform/platform-tokens.css` in de Honigfabriek-huisstijl** (geen eigen kleuren/fonts; fase-1-componentpatronen hergebruiken). Verzorgt de server-side **fan-out** van één Voor/Tegen-keuze over de in-scope rechten (ADR-0018) zodat de client één actie stuurt; atomair en row-level (ADR-0002). Geen frontend-npm-deps; assets in het code-artefact.
- **Gemini:** functionele/apparaat-/toegankelijkheidstest van de deelnemen-flow; happy path + foutpaden (verlopen sessie, ronde dicht, dubbel stemmen geweigerd).
- **Claude:** valideert dat geen token in browseropslag belandt, dat polling ETag/jitter respecteert en stopt bij sluiting, dat de UI alleen Voor/Tegen toont en de één-actie-fan-out klopt, en dat de stemknop de activatie-momentopname (ADR-0021) respecteert.
- **Bas:** go/no-go op de scopegrens v0.1; admin-UI en magic-link volgen als aparte sprints.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
