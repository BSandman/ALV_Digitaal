# Claude-validatie — Sprint 10: Eigenaar-frontend v0.1 (deelnemen-UI)

**Verdict: GROEN.** Cowork-review van de branch `feat/sprint-10-frontend-eigenaar` (PR #22) tegen ADR-0024/0011/0018/0021/0002 + de huisstijl. Gemini-review (#83) en de CI-gates (incl. de CloudLinux in-place deploy-job) staan groen.

## Getoetst en bevestigd

- **Static serving (ADR-0002, veilig):** `serveDeelnemenAsset` decodeert het pad met try/catch (400 op malformed), weigert `\`, NUL en elk `..`-segment, én doet daarna een `path.resolve`-containmentcheck (`file === root || startsWith(root+sep)`) — dubbele traversal-guard. Content-type-whitelist (404 buiten de lijst), `X-Content-Type-Options: nosniff`, app-shell-fallback op extensieloze paden, `no-cache` op index.html en `max-age=3600` op assets; API blijft `no-store`. 308-redirect `/deelnemen` → `/deelnemen/`.
- **Één-actie-fan-out (ADR-0018):** de client stuurt uitsluitend `{roundId, choice}`. `recordOwnerVote` vergrendelt de ronde (`FOR UPDATE`), bepaalt server-side álle in-scope entitlements van de participant (`FOR UPDATE`, join op meeting_quorum_entitlement + participant-toewijzing), en schrijft atomair één `vote_revision` per entitlement. Idempotent bij gelijke keuze (`changed:false`), en een afwijkende keuze schrijft een nieuwe revisie → **stem wijzigbaar tot sluiting**. `ENTITLEMENT_FORBIDDEN` als er geen in-scope recht is (ADR-0021).
- **Row-level isolatie (ADR-0002):** alle queries zijn gefilterd op `participantId`; `recordVote` heeft bovendien `assertOwnerScope`. Geen lek van andermans rechten/stemmen.
- **Alleen Voor/Tegen (ADR-0011):** twee keuzes, geen blanco/onthouding in de UI; `choiceLabel` kent enkel `voor`/`tegen`.
- **Geen token-at-rest (ADR-0024):** sessietoken leeft uitsluitend in een JS-var (`sessionToken`), gezet bij login, gewist bij logout/`SESSION_INVALID`; **geen** `localStorage`/`sessionStorage`/cookie/indexedDB (geverifieerd leeg). Trust-note in de UI.
- **Polling (ADR-0002):** `If-None-Match`/ETag met 304-afhandeling en jitter (`4000 + random·2000` ms); stopt bij gesloten/vastgestelde ronde en bij 401/`SESSION_INVALID`.
- **Toegankelijk & mobiel-eerst:** `lang="nl"`, semantische `main`/`section`/`h1`, `aria-live="polite"` op status en huidige stem, `role="alert"` op fouten, focusbeheer bij schermwissels, `autocomplete="off"` op de code.
- **Huisstijl:** UI laadt de **gevendorde** `platform-tokens.css` **v1.0.1** (herkomst-/versieregel aanwezig, ongewijzigde waarden), Archivo + IBM Plex Mono via Google Fonts, TF/NB/PG + Voor/Tegen-codering. Geen gehardcodeerde kleuren/fonts.
- **Deploy-contract:** `public/` is symmetrisch met `src/` opgenomen in `deploy.sh` (allowlist, backup, beide rollback-lussen, forward-`rsync` naar de subdir `"$remote_dir/public/"`) + contract-/integratietest; de CloudLinux in-place-gate is groen.
- **PII:** geen postcode-/IBAN-/e-mailpatronen in de frontend-assets (exacte detector-regexes).

## Openstaand (geen blokkers)
- Backlog: PII-detector harden (data-vs-parameter; 4-cijfer+CSS-eenheid, placeholder-domeinen) + guideline "nooit PII in harde broncode" — aparte mini-sprint met validatie.
- Deploy naar acceptatie is een aparte menselijke poort (ADR-0013), niet deze sprint.

→ **READY_FOR_INTEGRATION** (Mistral: gates, geen deploy).
