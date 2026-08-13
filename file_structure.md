# file_structure.md — projectstructuur- en opruimbeleid

**Doel:** één vast skelet dat in **elk** project (van Bas / de AI-ploeg) geldt, zodat elk project er ~hetzelfde uitziet en niemand later hoeft te schiften. Dit document is **project-agnostisch**: kopieer het ongewijzigd in ieder project. Projecttype-specifieke mappen komen erbovenop (een tool ≠ een simpele website ≠ een 3D-ontwerp), maar de kern hieronder is overal gelijk.

## 1. Kernprincipes

- **Root schoon.** In de projectroot staan alleen de vaste kernbestanden (§2) en mappen. **Geen losse dumps** in de root — geen kladbestanden, exports of notities die nergens bij horen.
- **Ontwerpen of combineren, niet 100× opnieuw verzinnen.** Eén canonieke plek per ding. **Geen** dubbele projectbomen (`*-v2/`, `*-new/`, `final-final`). Twijfel of iets nieuw moet: eerst kijken of het in een bestaand ontwerp past.
- **Ontwerp hoort waar het thuishoort.** Overkoepelend ontwerp staat in de kern (`bijbel.md` + `docs/`). Ontwerp dat alleen een **sub/module/branch** raakt, staat als `design.md` **ín** die sub/module/branch — niet centraal opgehoopt.
- **Experimenten apart.** Wegwerpwerk in `scratch/` of een git-branch, nooit los in de root.

## 2. Vaste kernbestanden (het skelet — in elk project)

| Bestand | Rol |
|---|---|
| `README.md` | **De ingang.** Wat is dit project, status, startpunt, en een kaart van de mappen. Eerste dat je (of een verse AI-sessie) leest. |
| `bijbel.md` | **Het boek met alle antwoorden.** De waarheid: kernarchitectuur, besluiten/ADR-register, domeinregels. Eén schrijver (bij meerdere AI's: de Architect); anderen stellen voor via de handoff. |
| `file_structure.md` | Dit beleid. In elk project identiek. |
| `docs/ADR/ADR-XXXX-*.md` | Besluiten als losse, genummerde ADR's. Een afwijking van een ADR = een nieuwe ADR, niet stilzwijgend. |
| `handoff.md` · `sprint.md` · `progress.md` | *(waar van toepassing)* Coördinatie: wie is aan zet, wat doen we nú, wat is gedaan. |

## 3. Naamconventies

- **Versies `vX.y.z`** — X = major (nieuwe functionaliteit/layout), y = minor (fixes, next-step-progressie), z = patch (bugfix, typo, kleine layout). Versie in de bestandsnaam **waar het kan**, maar **niet** als daardoor overal referenties bijgewerkt moeten worden — dan via git-tag / `package.json`.
- **Vermijd** `nieuw.md`, `test2.md`, `final-final.md`, en losse notities in de root.
- Documentnaam met versie waar zinvol: `naam_vX.y.z.md`.

## 4. Baseline-mappen (uitbreidbaar per projecttype)

- `docs/` — documentatie, incl. `docs/ADR/`.
- `src/` of `app/` — code (tool/app-projecten).
- `Archief/` — afgeronde/oude zaken (zie §5).
- `scratch/` — wegwerp-experimenten (buiten git of gitignored).
- `output/` — gegenereerde uitvoer.
- **Projecttype-specifiek** komt hierbovenop: een website, een backend-tool en een 3D-ontwerp hebben elk eigen extra mappen. De baseline (`README`/`bijbel`/`file_structure`/`Archief`/naamgeving) blijft gelijk.

## 5. Archief- en opruimbeleid

- Afgerond werk verhuist naar `Archief/<onderwerp>/`.
- **Opruimen in `Archief/`: eerst zippen, dan pas oudere zips weg.** Concreet:
  1. Maak van een afgeronde map een zip: `<onderwerp>_<YYYYMMDD>.zip`.
  2. Bewaar de **nieuwste** zip(s); verwijder **verouderde** zips van hetzelfde onderwerp.
  3. **Nooit hard verwijderen zonder zip-back-up.**
- Dubbele mappen (`… - kopie`) en editor-lockbestanden (`.~lock.*#`) horen niet in Archief thuis; ruim ze op volgens dezelfde zip-regel.

## 6. Multi-AI / rollen (waar van toepassing)

- Eén schrijver op `README.md` en `bijbel.md` (de Architect); andere rollen stellen wijzigingen voor via de `handoff`.
- Coördinatie loopt via de handoff; de git-steward centraliseert commits. Geen twee agents die tegelijk mergen.

## 7. Per-project toepassing

Kopieer dit bestand ongewijzigd in een nieuw project. Voeg in de **README** van dat project een korte "Afwijkingen"-sectie toe als het projecttype iets extra's nodig heeft — de kern uit dit document blijft leidend.
