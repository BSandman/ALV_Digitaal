# sprint.md — Sprint 10: Eigenaar-frontend v0.1 (deelnemen-UI)

**Doel:** het eigenlijke Fase-2-product zichtbaar maken. Een door de Node-app geserveerde **eigenaar-UI** bovenop de bestaande API, zodat een eigenaar kan **inloggen (code-fallback) → de open ronde zien → Voor/Tegen stemmen → bevestiging zien**, met polling (ETag/jitter, ADR-0002). Architectuur: **ADR-0024**. Spec: **`docs/gates/Codex-taak-frontend-eigenaar.md`**.

## Cadans — per blok

| Blok | Rol | Watcher | Inhoud |
|---|---|---|---|
| 1 | **Codex** (dev) | `--role codex` | Statische serving + `/deelnemen/`-UI + server-side één-actie-fan-out; contract-/e2e-tests; PR |
| 2 | *auto* | — | CI-gates + Gemini-review op de PR |
| 3 | **Claude** (validatie) | `--role claude` | Toets tegen ADR-0024/0011/0018/0021/0002 |
| 4 | **Mistral** (integratie) | `--role mistral` | Gates + datasets; geen deploy |

## Scope

- **In:** eigenaar-deelnemen-flow (login → open ronde → Voor/Tegen → bevestiging) tegen `/deelnemen/api/*`; code-login als ingang; sessietoken alleen in geheugen; polling met ETag/jitter dat stopt bij sluiting; server-side fan-out van één keuze over de in-scope rechten (per VvE, eigen breukdeel, exact decimal).
- **Uit (latere sprints):** admin-UI (activeren/sluiten/vaststellen, quorum) · magic-link/QR-token + PIN (ADR-0016) · gemachtigde-UX + digitale intake (ADR-0022) · sessieherstel na herlaad · meerdere bezorg-e-mails (ADR-0020).

## Definition of done

- End-to-end happy path groen op T (verse MariaDB 11.8.8); fan-out klopt (PG+TF, per VvE, exact decimal); row-level isolatie bewezen; geen token-at-rest; polling-304/stop-gedrag correct; statische serving zonder traversal.
- Bestaande Node-tests blijven groen; `npm run check`, Python-tests, architectuur-, release-, handoff- en PII-gates en Gemini-review groen.
- Claude valideert tegen ADR-0024; daarna integreert Mistral. **Geen deploy** in deze sprint.

## Buiten scope

Automatische deploy/productie · admin- en gemachtigde-schermen · magic-link/PIN · nieuwe frontend-frameworks of buildstap · sessiepersistentie in browseropslag.
