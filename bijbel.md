# bijbel.md — de waarheid voor ALV_Digitaal (fase 2)

Dit is de gezaghebbende bron. `sprint.md`/`handoff.md`/`progress.md` blijven kort en verwijzen hierheen. Wijzig de bijbel alleen bewust; een besluit dat verandert krijgt een nieuwe ADR.

## 1. Wat we bouwen

Digitaal ALV-eigenaarportaal voor VvE's De Bij, náást de bestaande beheerapp. Eigenaar logt in (QR/toegangscode), ziet de open stemronde en stemt; de beheerkant (strak aan de bestaande ALV-STEM-APP) opent/activeert rondes, ziet voortgang, sluit, en toont de uitslag. Fase 1 = `alv_presentie_stemmen_app` (fysieke ALV-ondersteuning). Fase 2 = dit digitale portaal.

## 2. Rollen (detail in `AGENTS.md`)

Claude = Architect/Validator · Codex = Developer (+ Git-steward) · Gemini = Tester · Mistral = Integrator/AVG-gatekeeper + deployer (lokaal) · Bas = eigenaar & go/no-go.

**Repo & topologie (ADR-0007):** de repo is `Platform/ALV_Digitaal` zelf (niet VvE_Werk — dat bevat PII/dossiers), als **privé GitHub-repo `ALV_Digitaal`** (origin). Codex, Claude en Mistral draaien lokaal op één machine en delen de werkmap; **Gemini draait als GitHub Action op elke PR** (`.github/workflows/gemini-review.yml`) en plaatst zijn review als PR-comment. Daarom loopt DEV→TEST via een **Pull Request**. Codex is Git-steward, init de repo en opent PR's. Repo-secret `GEMINI_API_KEY` (Bas). De Action stuurt de diff naar de Gemini-API → alleen veilig omdat de repo nooit echte PII draagt; een PII-voorwacht in de workflow blokkeert anders.

## 3. OTAP en domeinen

O + T lokaal (Docker), A + P op mijn.host `.starter`. Promotie strikt O → T → A → P, elke stap een poort met bewijs.

| Omgeving | Waar | URL | Data |
|---|---|---|---|
| O — Ontwikkeling | lokaal Docker | localhost | synthetisch (mini-seed) |
| T — Test | lokaal Docker (`dev,loadtest`) | localhost | synthetisch (Mistral) |
| A — Acceptatie | mijn.host | `acceptatie.honigfabriek.nl` | gepseudonimiseerd (Mistral) |
| P — Productie | mijn.host | `portaal.honigfabriek.nl` | echt, gehard |

Fase-1-domeinen: `stem.honigfabriek.nl` → Node-app gestopt, statische onderhoudspagina (`Platform/stem_onderhoudspagina/`); `stem-dev` gearchiveerd. Geen DB in fase 1 (JSON). Volledig OTAP-plan: `docs/OTAP_opzet_v1.0.0.md`.

## 4. Techniek (vast — ADR's)

- Productie: mijn.host `.starter`, **MariaDB 11.8.8** via socket, **Node 20**, Phusion Passenger. Docker alleen dev/test/CI. → ADR-0001, ADR-0003.
- **Zes architectuurregels** (meetlat van Claude): state alleen in DB; geen permanente verbindingen (polling + ETag/jitter); uitslag-schrijfacties atomair met `SELECT ... FOR UPDATE`; server-side row-level filtering; servertijd-UTC voor audit; geverifieerd client-IP via proxyheader. → ADR-0002.
- App zet **per verbinding** strikte `sql_mode` (dev = productie ongeacht serverdefault). → ADR-0003.

## 5. Data, PII en bewaartermijnen

- **Testdata:** synthetisch in T, gepseudonimiseerd in A, echt in P. Mapping echt↔pseudoniem blijft lokaal bij Mistral. → ADR-0004.
- **PII buiten het release-artefact:** de zip bevat alleen code, nooit `owners.*`/`events.json`/`audit.log`/`cycle.json`/snapshots. Aparte provisioning + blokkerende PII-scan-gate. → ADR-0005.
- **Datamodel:** een stem hoort bij het **appartementsrecht**, niet bij de persoon ("stem door recht X, ttv ALV vertegenwoordigd door [persoon]"; persoon = snapshot). → ADR-0006.
- **Retentie:** ALV-resultaat (agenda, voorstellen, notulen, stemmen, resultaat) **7 jaar**; persoonsdata zolang eigenaar **+ 2 jaar** na voldane verplichtingen. → ADR-0006.
- **Stemprocedure:** ronde sluiten → server berekent atomair → voorzitter **verifieert** uitkomst + besluitvoorstel → voorzitter **stelt vast** (aparte geauditeerde toestand). → ADR-0006.
- **Quorum (ADR-0009):** vergadering-breed en éénmalig — de voorzitter stelt het vóór de eerste ronde vast op grondslag van aanwezigen + ingeleverde machtigingen; daarna bevroren. Een ronde herberekent geen quorum, alleen de meerderheid.
- **Stemregistratie (ADR-0010):** keuzes = Voor, Tegen, Blanco, Onthouding. Een deelnemend recht dat niet/te laat stemt wordt bij sluiting als **Onthouding** vastgelegd (gelijk aan blanco stemformulier). Blanco + Onthouding zijn niet-beslissend; de meerderheid rekent over voor+tegen.
- **Domeinregels (ADR-0008):** een eigenaar kan rechten in twee sub-VvE's hebben — altijd PG + (TF óf NB) — nooit samengevoegd, per recht apart gestemd. Een afgegeven machtiging vervalt onherstelbaar zodra de eigenaar zelf inlogt. Stemgewichten (`DECIMAL(12,4)`) exact verwerken (SQL/decimal, geen float).

## 6. Toegangscode

Vorm `huisnummer+toevoeging-AAA-111-bb-!`, gebonden aan eigenaar + ALV-datum + agenda-/voorstellenversie. Aandachtspunt: deels raadbaar (huisnummer) → verplicht combineren met server-side rate limiting + apparaatbinding; het losse deel krijgt voldoende entropie + serverzijdige hash. Acceptatiecriterium (Claude).

## 7. Modules (richting vermarkting)

Geneste, **aan/uit-schakelbare** modules. Aanpak: modulaire monoliet in één repo met **contract per module** + **feature-registry**; geen import over modulegrenzen behalve via het contract. Polyrepo pas bij een bewezen commerciële + technische naad (eigen afnemer + eigen release-cadans). Detail: `docs/OTAP_opzet_v1.0.0.md` §8.

## 8. Versiebeheer

`vX.y.z` — X major/nieuwe functionaliteit·layout·architectuur, y minor/next-step, z patch. Versie in documentnaam en in `package.json` + git-tag; niet in elke bronbestandsnaam. ADR's genummerd en onveranderlijk.

## 9. ADR-register

- ADR-0001 — Docker alleen dev/test/CI
- ADR-0002 — Shared-hosting-architectuurregels (zes regels)
- ADR-0003 — Databasekeuze (MariaDB 11.8.8 bevestigd)
- ADR-0004 — OTAP-topologie + testdatastrategie
- ADR-0005 — PII buiten release + provisioning
- ADR-0006 — Bewaartermijnen + datamodel + stemvaststelling
- ADR-0007 — Repo-scope (ALV_Digitaal = eigen repo) + coördinatie-topologie
- ADR-0008 — Domeinregels: multi-VvE-stemrechten (PG + TF/NB, nooit samenvoegen), machtiging vervalt bij login, exacte rekenkunde
- ADR-0009 — Quorummodel: vergadering-breed, éénmalig door voorzitter vastgesteld, grondslag aanwezigen + machtigingen, bevroren; geen herberekening per ronde
- ADR-0010 — Stemregistratie: niet/te laat gestemd = onthouding (geauditeerd), gelijk aan blanco stemformulier; blanco+onthouding niet-beslissend
- ADR-0011 — In-app stemkeuze: alleen Voor/Tegen (twee knoppen); onthouding (afgeleid) en blanco (fysiek formulier) alleen als resultaat

## 10. Sleuteldocumenten

`docs/OTAP_opzet_v1.0.0.md` (OTAP-plan) · `docs/Architectuur_en_infravoorstel_v0.2.0.md` (architectuur) · `docs/Mistral_Lokaal_setup_runbook_v1.0.0.md` · `docs/gates/handoff-template.md` (6-delig overdrachtsformaat) · `docs/gates/Codex-taak-10.2_T-run-en-CI-gates.md` · `AGENTS.md` (pijplijnregels).

## 11. Openstaande beslispunten

- Juridisch (Bas): naam vertegenwoordiger in 7-jaars-notulen bewaren of pseudonimiseren na spoor B? → ADR-0006 §Open punt.
- Secrets-locatie op productie (DirectAdmin-env vs. bestand buiten webroot) — vastleggen vóór eerste A-deploy.
- Derde MariaDB-database op `.starter` voor A naast P — inrichten bij mijn.host.
