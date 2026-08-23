# bijbel.md — de waarheid voor ALV_Digitaal (fase 2)

Dit is de gezaghebbende bron. `sprint.md`/`handoff.md`/`progress.md` blijven kort en verwijzen hierheen. Wijzig de bijbel alleen bewust; een besluit dat verandert krijgt een nieuwe ADR.

## 0. Leeswijzer (ADR-0000)

Deze bijbel is een **kaart, geen territorium**: een verwijzende index + de harde invarianten. Detail staat in de ADR's/specs, niet hier. Elke ADR/spec/module/taakdoc draagt een vaste **`Raakt:`-regel** met forward-links naar wat het raakt (= de look-ahead: zie vóór je iets wijzigt wat het verderop raakt). Het register (§9) is daarmee een **traverseerbare index** die je van besluit naar besluit kunt aflopen; een korte `Raakt:`-keten = schone grenzen, een lange = een koppelings-smell. Open keuzes in taakdocs krijgen altijd **voorkeur + gevolg-van-afwijken** mee. Volledige conventie: **ADR-0000**.

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

## 9. ADR-register (traverseerbare index — ADR-0000)

Elke entry: korte kern + **`Raakt:`** (forward-links = look-ahead). Loop de keten af om de gevolgen van een wijziging vooraf te zien; korte keten = schone grens, lange keten = koppelings-smell.

- **ADR-0000** — Kennis-/documentatiearchitectuur: bijbel = index + invarianten, `Raakt:`-regel per stuk, register = traverseerbare index, ketenlengte = smell, voorkeur-met-gevolg in taakdocs. **Raakt:** bijbel.md · AGENTS.md · handoff-template · alle ADR's/specs.
- **ADR-0001** — Docker alleen dev/test/CI. **Raakt:** ADR-0003 · ADR-0004.
- **ADR-0002** — Shared-hosting-architectuurregels (zes regels; de meetlat). **Raakt:** ADR-0003.
- **ADR-0003** — Databasekeuze (MariaDB 11.8.8 bevestigd), strikte per-verbinding `sql_mode`. **Raakt:** ADR-0001 · ADR-0002.
- **ADR-0004** — OTAP-topologie + testdatastrategie. **Raakt:** ADR-0001 · ADR-0005.
- **ADR-0005** — PII buiten release + provisioning + blokkerende scan-gate. **Raakt:** ADR-0004 · ADR-0007 (PII-voorwacht) · ADR-0013.
- **ADR-0006** — Bewaartermijnen + datamodel + stemvaststelling. **Raakt:** ADR-0008 · ADR-0010 · ADR-0021.
- **ADR-0007** — Repo-scope (ALV_Digitaal = eigen repo) + coördinatie-topologie. **Raakt:** ADR-0005 · ADR-0023 · ADR-0025.
- **ADR-0008** — Domeinregels: multi-VvE-stemrechten (PG + TF/NB, nooit samenvoegen), machtiging vervalt bij login, exacte rekenkunde. **Raakt:** ADR-0014 · ADR-0018 · ADR-0022.
- **ADR-0009** — Quorummodel — **VERVANGEN door ADR-0021**; kernregel "grondslag = presentie, niet uitgebrachte stemmen" blijft. **Raakt:** ADR-0021.
- **ADR-0010** — Stemregistratie: niet/te laat gestemd = onthouding (geauditeerd), gelijk aan blanco; blanco+onthouding niet-beslissend. **Raakt:** ADR-0011 · ADR-0021.
- **ADR-0011** — In-app stemkeuze: alleen Voor/Tegen (twee knoppen); onthouding (afgeleid) en blanco (fysiek) alleen als resultaat. **Raakt:** ADR-0010 · ADR-0018 · ADR-0024.
- **ADR-0012** — Secrets-locatie: configbestand buiten de webroot (chmod 600) per omgeving via niet-geheime `SECRETS_FILE`; nooit in Git/artefact/.htaccess. **Raakt:** ADR-0002 · ADR-0013.
- **ADR-0013** — CD-automatisering: acceptatie via handmatige `workflow_dispatch`; productie achter GitHub Environment + verplichte approval (Bas); SSH via deploy-key. **Raakt:** ADR-0005 · ADR-0012 · ADR-0026.
- **ADR-0014** — Basisdatamodel: object = anker, 1:1 breukdeel + 1:1 eigenaarstitel; meerdere objecten per eigenaar apart gestemd; PG↔TF/NB administratief gekoppeld (gewichtloos); bron = TwinQ. **Raakt:** ADR-0006 · ADR-0008 · ADR-0018.
- **ADR-0015** — Pijplijn-guardrails: deterministische state-lint (CI-gate + hook), tail-context, idempotente provisioning; prerequisites voor onbemande autorun. **Raakt:** ADR-0017 · ADR-0023 · ADR-0025 · ADR-0026.
- **ADR-0016** — Auth-model: magic-link-als-QR (gebonden token) + toegangscode-fallback + optionele roteerbare PIN; geen e-mail-OTP als live-drempel. **Raakt:** ADR-0020 · ADR-0022.
- **ADR-0017** — Autorun: watcher-act() start de rol-runner; vangrails (kill-switch, loop-cap, stop-on-error→BLOCKED, deploy blijft mens); één gededupliceerde notifier; attended-first. **Raakt:** ADR-0015 · ADR-0019 · ADR-0025.
- **ADR-0018** — Stemronde-scope per VvE + één stemactie per eigenaar (gefan-out naar in-scope rechten, niet splitsbaar); quorum/2⁄3 per betrokken VvE; geen acclamatie. **Raakt:** ADR-0008 · ADR-0011 · ADR-0021.
- **ADR-0019** — Rol-runners voor autorun: contract (stdin-context → één beurt → volgende READY, commit+push, schoon/in-sync, exit 0, nooit deploy). **Raakt:** ADR-0017 · ADR-0025.
- **ADR-0020** — Login-identiteit: stemmer = eigenaar; één eigenaarstitel = één credential = één magic-link naar één primaire e-mail; datakwaliteitspoort bij setup. **Raakt:** ADR-0016 · ADR-0022.
- **ADR-0021** — Presentie & quorum (**supersedes ADR-0009**): presentie = login, telt monotoon; quorum per ronde bij admin-activatie; laatkomer pas volgende ronde; present-niet-gestemd/vertrokken = onthouding. **Raakt:** ADR-0009 · ADR-0010 · ADR-0018.
- **ADR-0022** — Machtiging & stemformulier: twee stromen op één genummerd formulier; gemachtigde krijgt eigen QR/magic-link; eigenaar-login vernietigt machtiging óf formulier onherstelbaar (**breidt ADR-0008 uit**). **Raakt:** ADR-0008 · ADR-0016 · ADR-0020.
- **ADR-0023** — PR-gate auto-advance: Action merget een groene pipeline-PR en zet de baton READY_FOR_TEST→READY_FOR_VALIDATION; kill-switch `PIPELINE_AUTOMERGE` default uit; fail-safe; nooit deploy. **Raakt:** ADR-0015 · ADR-0025 · ADR-0026.
- **ADR-0024** — Frontend-architectuur eigenaar-portaal: vanilla/no-build onder `/deelnemen/`, sessietoken alleen in geheugen, polling met ETag/jitter, in-app alleen Voor/Tegen met server-side fan-out; Honigfabriek-huisstijl op `platform-tokens.css`. **Raakt:** ADR-0011 · ADR-0018 · `Platform/Platform_Stijlgids_v1.0.0.md`.
- **ADR-0025** — GitSteward als apart deterministisch proces: enige git-schrijver naar `main` + enige houder van `GH_TOKEN`; LLM-runners committen lokaal maar pushen niet; verplichte block-finalize; **vervangt de git-uitvoeringsdelen van ADR-0017/0019**. **Raakt:** ADR-0007 · ADR-0017 · ADR-0019 · ADR-0023.
- **ADR-0026** — CI/CD-herinrichting github-native (gefaseerd): 1 sprint = 1 PR (branch alleen als merge-source), guardrails vanuit vertrouwde `main`, native auto-merge pas ná bewezen gates, deploy blijft mens. **Raakt:** ADR-0013 · ADR-0015 · ADR-0023 · ADR-0025.

## 10. Sleuteldocumenten

`docs/ADR/ADR-0000-kennis-en-documentatiearchitectuur.md` (doc-conventie) · `docs/OTAP_opzet_v1.0.0.md` (OTAP-plan) · `docs/Architectuur_en_infravoorstel_v0.2.0.md` (architectuur) · `docs/Mistral_Lokaal_setup_runbook_v1.0.0.md` · `docs/gates/handoff-template.md` (6-delig overdrachtsformaat) · `docs/gates/Codex-taak-10.2_T-run-en-CI-gates.md` · `AGENTS.md` (pijplijnregels) · `../Platform_Stijlgids_v1.0.0.md` + `../platform-tokens.css` (platform-huisstijl, honigfabriek).

## 11. Openstaande beslispunten

- Juridisch (Bas): naam vertegenwoordiger in 7-jaars-notulen bewaren of pseudonimiseren na spoor B? → ADR-0006 §Open punt.
- Secrets-locatie op productie (DirectAdmin-env vs. bestand buiten webroot) — vastleggen vóór eerste A-deploy.
- Derde MariaDB-database op `.starter` voor A naast P — inrichten bij mijn.host.
