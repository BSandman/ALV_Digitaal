---
sprint: 3
state: READY_FOR_VALIDATION
owner: claude
since: 2026-08-11T23:22:15Z
next: codex
action_required_by: none
blocked: false
note: "PR #8 is groen voor Claude-validatie: lsnode-requirebare startentry, gecontroleerd bootstrapfalen en geredigeerde stderr-diagnostiek."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 3 — LiteSpeed lsnode-startentry (Claude-validatie).** De definitieve oorzaak van de A-deploy-503 was `ERR_REQUIRE_ASYNC_MODULE`: LiteSpeed `lsnode.js` laadt `src/start.js` synchroon via `require()`, terwijl de entry top-level `await` bevatte.

Codex heeft:
1. top-level `await` verwijderd en secretsconfiguratie + dynamische serverimport in een direct gestarte `startupPromise` geplaatst;
2. onder Node 20 bewezen dat CommonJS `require('src/start.js')` de ESM-entry laadt en de server pas na configuratie start;
3. bewezen dat een bootstrapfout geen listener opent, diagnostiek schrijft en het proces non-zero beëindigt;
4. bij rode healthcheck vóór rollback maximaal 120 regels `nodeapp/stderr.log` toegevoegd, begrensd tot de app-root en met dotenv-, JSON- en MariaDB-URI-secrets geredigeerd;
5. runtime-notities en acceptatierunbook gecorrigeerd van Passenger naar LiteSpeed/lsnode.

Bewijs: 61/61 tests, architectuur-, release- en PII-gates groen; Node 20/Linux require- en faalscenario's groen; Linux in-place deploy, stderr-redactie en beide rollbackpaden groen; GitHub gates + Gemini groen. Claude — valideer PR #8. Daarna: Codex merge; Bas rerunt de acceptatiedeploy zonder handmatige `PORT`.

---

## Vorige beurt (referentie)

**Sprint 3 — PR #6 GROEN (Claude), klaar voor merge.** In-place deploy in de vaste app-root `nodeapp`, backups buiten de app-root, auto-rollback bij npm ci-/health-falen, symlink-/pad-weigeringen, lock, SHA256-check. 58/58 tests + rollback-scenario's, gates + Gemini groen. Zie `docs/gates/Claude-validatie-sprint3.md §5`.

**Follow-up (productie, niet-blokker acceptatie):** de `--confirm-no-open-round`-poort is een operator-attestatie; vóór de portaal-livegang toevoegen: live MariaDB-check die deployen weigert bij een ronde met status `open`/`closing`.

Codex (steward): **merge PR #6** naar `main`.

**Blok 4 (Bas) na merge:** (1) schema `infra/mysql/init/01-schema.sql` laden in `cn111993_acceptatie`; (2) GitHub → Actions → "Deploy acceptatie" → Run workflow (main) met de no-open-round-bevestiging; (3) healthz groen checken. Verifieer daarbij `SECRETS_FILE`-doorgifte + `X-Forwarded-For`. Node-app staat al goed (app-root `nodeapp`, startup `src/start.js`, Production). Daarna valideert Claude het draaiende systeem.

**Openstaand (design):** ADR-0014 basisdatamodel — rechten autonoom, representatie-relatie i.p.v. persoon-bundeling, woning↔parkeer administratieve (ont)koppeling (1:0..n), TwinQ-CSV als bron. Converter #17 on hold.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-11 — Codex: PR #5 gemerged (`4131468`). Sprint 3 blok 0+1 compleet.
- 2026-08-11 — Bas: DirectAdmin app-root-wijziging → CloudLinux relocate-fout (current-symlink onverenigbaar).
- 2026-08-11 — Claude: deploy-model → in-place (§3b); terug naar Codex voor deploy.sh-aanpassing. → READY_FOR_DEV.
- 2026-08-11 — Codex: PR #6 in-place deploy + rollback; 58 tests, gates en Gemini groen. → READY_FOR_VALIDATION.
- 2026-08-11 — Codex: PR #7 CloudLinux nodevenv-PATH; 59 tests, Linux-randgevallen, gates en Gemini groen. → READY_FOR_VALIDATION.
- 2026-08-12 — Codex: PR #8 LiteSpeed/lsnode-startentry; 61 tests, Node 20 require/failure, stderr-redactie, gates en Gemini groen. → READY_FOR_VALIDATION.
