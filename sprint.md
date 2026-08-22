# sprint.md — Sprint 10: Eigenaar-frontend v0.1 (deelnemen-UI, mobiel-eerst)

**Doel:** het eerste zichtbare Fase-2-product — een door de Node-app geserveerde **eigenaar-UI** (mobiel-eerst) waarmee een eigenaar kan **inloggen (code-fallback) → de open ronde zien → Voor/Tegen stemmen (wijzigbaar tot sluiting) → bevestiging zien**, met polling volgens ADR-0002. Architectuur/scopegrens: **ADR-0024**. Spec: **`docs/gates/Codex-taak-frontend-eigenaar.md`**. Visuele + interactie-referentie: **`Platform/_design-prestage/deelnemen/deelnemen-v0.1.html`** (klikbaar, Honigfabriek-huisstijl, gesimuleerde data — akkoord als v0.1-milestone; bewust buiten de repo).

> **Attended, geen deploy.** Reguliere feature-sprint via de PR-route; productcode uitsluitend op de feature-branch, nooit rechtstreeks naar `main`. Deploy naar acceptatie is een aparte, latere menselijke poort (ADR-0013).

## Cadans — per blok

| Blok | Rol | Watcher | Inhoud |
|---|---|---|---|
| 1 | **Codex** (dev) | `--role codex` | statische serving + `app/public/deelnemen/`-UI (login→ronde→stem→bevestig), één-actie-fan-out, gevendorde tokens; tests; PR op `feat/sprint-10-frontend-eigenaar` |
| 2 | *auto* | — | CI-gates + Gemini-review op de PR |
| 3 | **Claude** (validatie) | `--role claude` | Toets tegen ADR-0024/0011/0018/0021/0002 + huisstijl (gevendorde tokens, geen token-at-rest, row-level isolatie) |
| 4 | **Mistral** (integratie) | `--role mistral` | Gates; **geen deploy** |

## Scope

- **In:** door Node geserveerde eigenaar-UI (login code-fallback, wachtscherm/rondescherm met ETag+jitter-polling, Voor/Tegen-stem wijzigbaar tot sluiting, bevestiging), server-side één-actie-fan-out (ADR-0018), veilige statische serving, mobiel-eerst + basis-a11y, verplicht op de gevendorde Honigfabriek-tokens.
- **Uit (latere sprints):** admin/voorzitter-frontend (ronde activeren/sluiten/vaststellen — aparte **tablet/pc-view**) · magic-link/QR + PIN · gemachtigde-UX · sessieherstel na herlaad · meerdere bezorg-e-mails · deploy.

## Definition of done

- End-to-end happy path op T (verse MariaDB 11.8.8): code-login → open ronde → Voor → bevestiging; `GET vote` toont de keuze; keuze **wijzigbaar** zolang de ronde open is (nieuwe `POST vote` overschrijft atomair, geen dubbeltelling).
- Fan-out klopt (één actie → elk in-scope recht, per VvE geteld, exact decimal); row-level isolatie bewezen; geen token-at-rest; polling stopt bij gesloten/vastgestelde ronde.
- Veilige statische serving (geen `..`-traversal, gewhiteliste content-types); bestaande Node-tests groen.
- UI draagt de Honigfabriek-look via de **gevendorde** `platform-tokens.css` (geen gehardcodeerde kleuren/fonts), domeincodering TF/NB/PG + Voor/Tegen, mobiel-eerst + basis-a11y.
- `npm run check` + Python-tests + architectuur-, release-, handoff- en PII-gates + Gemini-review groen. **Geen deploy; geen productcode naar `main` buiten de PR-route.**

## Buiten scope

Admin/voorzitter-frontend (aparte tablet/pc-view, latere sprint) · magic-link/QR + PIN · gemachtigde-intake · sessieherstel · deploy/productie · onbemand draaien zonder aparte Bas-go.
