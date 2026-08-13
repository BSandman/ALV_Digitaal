# ADR-0022 — Machtiging en stemformulier: twee stromen, één genummerd formulier; digitale gemachtigde-link (breidt ADR-0008 uit)

**Status:** geaccepteerd
**Datum:** 12 augustus 2026
**Beslisser:** Bas (domein/juridisch); vastgelegd door Claude (Architect & Validator)
**Context-links:** [[ADR-0008]] (machtiging vervalt bij login — hier uitgebreid), [[ADR-0016]] (magic-link/QR), [[ADR-0021]] (presentie/quorum), [[ADR-0018]] (één stemactie per ronde), [[ADR-0010]] (onthouding).

## Context

Vóór een (Zoom-)ALV komen twee papieren stromen binnen, beide op **hetzelfde fysieke formulier**: een **machtiging** (volmacht aan een ander) en een **stemformulier** (eigen vooraf uitgebrachte stem). ADR-0008 dekte de conflictregel maar hield digitaal machtigen buiten scope. Nu wordt de gemachtigde digitaal in staat gesteld te stemmen.

## Besluit

### 1. Uniek formuliernummer

Elk fysiek formulier krijgt een **uniek nummer**, dat in alle auditsporen wordt vastgelegd.

### 2. Machtigingsstroom

De eigenaar vult naam **én e-mail** van de gemachtigde in, tekent, en levert **≥ 1 dag** vóór de vergadering in. Het team verwerkt de machtiging en stuurt de **gemachtigde** een eigen QR/magic-link. Bij inloggen van de gemachtigde wordt geauditeerd (servertijd-UTC):

> `[timestamp] [naam gemachtigde] logt in — gemachtigd door [naam eigenaar] via [formuliernr] [verwerkingsdatum]`

De **oorspronkelijke** link van de eigenaar blijft **actief**.

### 3. Stemformulierstroom

Identiek formulier: de eigenaar vult in en tekent; het team **scant en verwerkt** de stem als **vooraf uitgebrachte** stem. Audit:

> `[timestamp] [naam eigenaar] [formuliernr] verwerkt door [naam teamlid]`

Omdat formulieren vooraf verwerkt zijn, **start een ronde niet op nul**.

### 4. Onherstelbare vernietiging bij eigen login (uitbreiding ADR-0008)

Heeft de eigenaar vooraf een **machtiging** óf een **stemformulier** ingediend en logt hij tijdens de ALV **zelf** in, dan vervalt die machtiging/stemformulier **onmiddellijk en onherstelbaar** (geauditeerd, servertijd-UTC). Dit voorkomt dubbele stemuitbrenging per recht. ADR-0008 dekte dit voor de machtiging; hier expliciet **uitgebreid naar het stemformulier**.

### 5. Geparkeerd (latere iteraties)

- **Digitale intake** van machtiging/stem via app of e-mail (bijv. een functioneel machtigingsadres + workflow) — nu te veel werk.
- **Gemachtigde die zélf eigenaar is:** UX om de eigen stem en de vertegenwoordigde stem(men) te combineren (bijv. extra QR → extra tabblad/nest met de stemmen van de uitgever). Complexe materie — apart en in korte slagen uit te werken; raakt de één-actie-per-ronde-regel (ADR-0018).

## Overwogen alternatieven

- **Digitaal machtigingsbeheer nu volledig bouwen.** Afgewezen: te veel werk; papieren intake blijft, alleen de gemachtigde-toegang wordt digitaal.
- **Eigenaarslink blokkeren zodra een machtiging is uitgegeven.** Afgewezen: de eigenaar mag zich bedenken; zijn login blijft de onherstelbare override (§4).

## Gevolgen

- **Codex:** formuliernummer als sleutel in de auditsporen; machtiging koppelt een gemachtigde-credential aan de vertegenwoordigde titel/rechten; verwerkte stemformulieren als vooraf geregistreerde `vote_revision`; eigenaar-login zet machtiging/stemformulier onherstelbaar op vervallen (trigger/append-only). Geen echte PII in T/CI (ADR-0004/0005).
- **Claude:** valideert de vervalt-bij-login-transitie (nu ook voor stemformulier) en dat een ronde correct vooraf-gevuld start.
- **Bas:** papieren intake + scannen/verwerken door team met formuliernummer; de gemachtigde-UX en digitale intake volgen later.
- Wijziging vereist een nieuwe ADR die deze "supersedes".
