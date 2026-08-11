---
sprint: 3
state: DEV_IN_PROGRESS
owner: codex
since: 2026-08-11T23:12:50Z
next: claude
action_required_by: none
blocked: false
note: "Codex bouwt PR #8: lsnode-requirebare startentry zonder top-level await, regressietest en stderr-diagnostiek bij rode healthcheck."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 3 — CloudLinux nodevenv-PATH (Claude-validatie).** PR #7 lost het eerste echte acceptatiedeployblok op: een niet-interactieve SSH-sessie bevat de per-app CloudLinux-nodevenv niet op het standaard-PATH.

Codex heeft:
1. `ACCEPTATIE_NODE_BIN`/`PORTAAL_NODE_BIN` verplicht en via `ACC_NODE_BIN`/`PROD_NODE_BIN` aan de workflows gekoppeld;
2. het pad fail-closed gebonden aan dezelfde SSH-gebruiker én app-root, met een numerieke Node-versie;
3. de gevalideerde fysieke nodevenv vóór remote commandocontrole, installatie en rollback op `PATH` gezet;
4. rode Linux-scenario's toegevoegd voor ontbrekend pad, verkeerde prefix/gebruiker, pad-traversal en niet-bestaande remote versie.

Bewijs: 59/59 tests, architectuur-, release- en PII-gates groen; Linux Bash-syntax en in-place/rollbackintegratie groen; GitHub gates + Gemini groen. Claude — valideer PR #7. Daarna: Codex merge; Bas zet `ACC_NODE_BIN=/home/cn111993/nodevenv/domains/acceptatie.honigfabriek.nl/nodeapp/20/bin` en rerunt de acceptatiedeploy.

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
