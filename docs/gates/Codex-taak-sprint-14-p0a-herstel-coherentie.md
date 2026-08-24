# Codex-taak — Sprint 14: P0a-herstel + coherentie-gate

**Ontwerp:** ADR-0026 (CI/CD-herinrichting) + ADR-0000 (kennis-/coherentie). **Zelf-modificerend, attended.** Herstelronde na Sprint 13: PR #23 mergde vroegtijdig (bug) en de fix-ronde bleek mergeklaar maar was het niet (Codex + Claude review, 24-08). Deze sprint fixt de **klasse**, niet het geval. **Native auto-merge blijft OFF.**

**Raakt:** ADR-0026 · ADR-0023 (PR-gate) · ADR-0025 (GitSteward) · ADR-0015 (guardrails) · ADR-0000 (coherentie) · `.github/workflows/ci.yml` · nieuw `.github/workflows/p0a-admin-preflight.yml` · `scripts/pipeline_guard.py` · `scripts/git_steward.py` · `scripts/watch_handoff.py` · nieuw `scripts/check_coherence.py` · `config/pipeline-sprint.json` · `sprint.md` · `handoff.md`. Loop deze keten af vóór je iets wijzigt: een verandering in de baton-transitie (`git_steward`), de verificatie-lane (`ci.yml`/preflight) of de bron-van-waarheid (`config`) raakt de rest — afwijken van één stuk breekt de andere.

## Werkwijze
- **Basisbranch:** vertak Sprint 14 van de tip van `agent/sprint-13-cicd-p0a-fix1` (`9243eec`) — **voorkeur**, want findings 1–8 zijn daar grotendeels goed; **gevolg van vanaf `main` starten:** je herbouwt al dat werk = verspilling. Nieuwe branch: **`agent/sprint-14-p0a-herstel-coherentie`**.
- **Geen open PR laten staan** vanuit de fix1-branch (anders tript de 1-PR-invariant); Sprint 14 krijgt één verse PR naar `main`.
- Watchers op **`main`**, attended, `--max-turns 1`; **merge attended exact-op-SHA** (`PIPELINE_AUTOMERGE` blijft `off`). Schoon + in-sync eindigen.

## Scope (in) — met voorkeur + gevolg per keuze

### 1. Lane A — onbevoorrechte PR-CI-verificatie
De PR-workflow (`ci.yml`, draait PR-code) verifieert **alleen wat `GITHUB_TOKEN` veilig kan lezen**:
- `PIPELINE_AUTOMERGE == off` (via `vars`, geen API);
- de oude `pipeline-autoadvance`-workflow is `disabled_manually` (via `actions: read`);
- sprintmetadata + `config/pipeline-sprint.json` kloppen (`pipeline_guard setup`, lokaal `--defer-live-safety-to-ci`-equivalent voor de admin-as);
- PR-nummer, branch en gecontroleerde commit-SHA komen overeen.

**Verwijder de branch-protection-lees uit deze lane** (`gh api .../branches/main/protection/...` uit `ci.yml`). **Reden/voorkeur:** dat endpoint vereist `Administration: read`, en dat recht bestáát niet binnen de instelbare `GITHUB_TOKEN`-permissies. **Gevolg van het tóch daar laten:** 403 → fail-closed → CI permanent rood om een omgevingsreden (de fout die deze hele ronde veroorzaakte). Workflow-`permissions` in Lane A blijven minimaal: `contents: read`, `actions: read`, `pull-requests: read`. **Nooit** een admin-/App-token in deze PR-be­ïnvloede workflow.

### 2. `p0a-admin-preflight` — aparte, vertrouwde beheercontrole
Nieuwe workflow `.github/workflows/p0a-admin-preflight.yml` die:
- **uitsluitend de workflowversie van `main`** gebruikt (geen `checkout` van PR-code, geen PR-artifacts/caches);
- alleen GitHub-API-aanroepen doet (geen build/test van repo-code);
- **per run een kortlevend installation-token mint** met `actions/create-github-app-token@v3` en dáármee branch-protection van `main` leest met `Administration: read`;
- verifieert: strict/up-to-date **uit**, required checks aanwezig zoals bedoeld;
- **fail-closed** eindigt (exit ≠ 0 bij twijfel/onleesbaar);
- start via **`workflow_dispatch`** (aanvankelijk handmatig door Bas).

**Identiteit — GitHub App, géén opgeslagen token, géén PAT.** Een App-installatietoken is kortlevend en wordt elke run opnieuw gemint; sla het dus nooit als secret op. GitHub schrijft dit patroon voor: Client ID als **repository variable**, private key als **repository secret**, token per run genereren.
- Repository variable: `ADMIN_PREFLIGHT_APP_CLIENT_ID`
- Repository secret: `ADMIN_PREFLIGHT_APP_PRIVATE_KEY`
- Tijdelijke stap-output (nooit opgeslagen): `ADMIN_PREFLIGHT_APP_TOKEN`

App-instellingen: installatie **alleen `ALV_Digitaal`**, `Administration: read-only`, overige rechten **none**, webhooks **uit**. **Gevolg van afwijken (PAT of opgeslagen token):** breder/langlevender geheim, grotere blast-radius bij lek — GitHub raadt Apps expliciet boven PAT's aan.

Referentiepatroon in de workflow:

```yaml
- name: Maak tijdelijk beheer-token
  id: admin-token
  uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.ADMIN_PREFLIGHT_APP_CLIENT_ID }}
    private-key: ${{ secrets.ADMIN_PREFLIGHT_APP_PRIVATE_KEY }}
- name: Controleer branch protection
  env:
    GH_TOKEN: ${{ steps.admin-token.outputs.token }}
  run: gh api repos/${{ github.repository }}/branches/main/protection/required_status_checks
```

**Inert-gedrag zolang de variable óf de private key ontbreekt** (geen stille fail-open, maar ook geen blokkade): `p0a-admin-preflight` blijft **buiten** de verplichte PR-gates; een handmatig gestarte preflight **stopt met een duidelijke melding**; **Lane A** blijft zonder adminrechten werken; **Codex wordt niet geblokkeerd**.

### 3. CAS-baton — volledige swap (draait finding-7 terug)
De veldsgewijze handoff-merge kan een nieuwe `state`/`owner` combineren met beschrijvende velden van de vórige toestand → semantisch tegenstrijdige baton. **Voorkeur:** frontmatter = **volledige CAS** — elke onverwachte frontmatter-afwijking t.o.v. de geobserveerde parent = **verloren race → herlezen + overgang opnieuw berekenen** op verse `main`; alleen `progress.md` (append-only) mergen; op de idempotente "doel-al-bereikt"-tak de **volledige** bedoelde staat + invarianten toetsen (niet enkel `state`/`owner`/`sprint`). **Gevolg van veldsgewijs houden:** technisch-geldige maar inhoudelijk tegenstrijdige baton kan doorlopen. **Test:** verwijder `test_concurrent_same_state_descriptive_fields_are_preserved_fieldwise`; vervang door een test die bewijst dat een onverwachte frontmatter-divergentie tot re-read/recompute leidt (geen veld-merge).

### 4. Nood-rebaseplan — eenduidige SHA-rollen
Vervang de ambigue `old_sha` door drie expliciete rollen: `old_main_base_sha`, `new_main_sha`, `expected_old_branch_head_sha`. Controleer vóór uitvoering merge-base + voorouderrelaties; vul een exacte `--force-with-lease=<branch>:<expected_old_branch_head_sha>` in. **Voorkeur:** dit nu hardmaken, ook al is het pad dry-run-only. **Gevolg van uitstellen:** een uitvoerder kan bij een echte noodrebase de verkeerde commits herschrijven (data-verlies op een safety-pad). Blijft dry-run-advies tot de ancestry-checks bewezen zijn.

### 5. Coherentie-gate + single source of truth (de "stop")
**`config/pipeline-sprint.json` = de autoriteit** voor sprint/branch/versie/tag. `sprint.md` en `handoff.md` **verwijzen** ernaar en dupliceren de waarden niet. Nieuw `scripts/check_coherence.py` dat **luid faalt** (exit ≠ 0) zodra onderdelen elkaar tegenspreken:
- branch in `config` == `handoff.md` == `sprint.md` == de actuele git-branch (waar van toepassing);
- versie/tag-namespace botst niet met de app-versie in `package.json` (infra-namespace ≠ `vX.y.z`);
- de gedeclareerde `Raakt:`-verwijzingen in het taakdoc bestaan als bestand/ADR (bestands-existentie, geen semantiek).

Draai de gate in **Lane A CI** én als **lokale pre-flight** in de watcher-setup-guard. **Voorkeur:** dit is de kern van deze sprint — het hándhaaft de ADR-0000-index (de index declareert koppelingen, de gate bewijst dat ze kloppen). **Gevolg van weglaten:** de tegenspraak-klasse (sprint.md ≠ handoff ≠ config, versiebotsingen) blijft terugkomen.

### 6. Consistentie-herstel (in één klap)
Trek `sprint.md`, `handoff.md`, `config/pipeline-sprint.json`, de branchnaam en de tests **allemaal** naar Sprint 14. De `0.2.0`-botsing is al opgelost via de infra-namespace; houd dat. Geen enkel bestand mag na deze sprint nog naar `agent/sprint-13-*` of een app-`vX.y.z`-tag voor deze infra-sprint verwijzen.

## Scope (uit — P0b of later)
Native auto-merge activeren · echte Gemini-verdict-check · PII context-aware gate · Environment/deploy-poort · dedup-notifier (indien nog niet gedaan) · lease · labels-migratie · validatie-voor-merge. De `p0a-admin-preflight` blijft **handmatig**; automatisch draaien = P0b.

## Acceptatiecriteria / go-no-go → P0b
1. **Lane A groen zónder admin-lees:** `ci.yml` verifieert automerge-off + workflow-disabled + metadata/config + PR/SHA; geen `branch/protection`-call meer in de PR-lane; permissions minimaal.
2. **`p0a-admin-preflight` bestaat en is correct begrensd:** alleen `main`-workflow, geen PR-code/checkout/artifacts, puur API, `Administration: read` via een **per-run gemint App-token** (`actions/create-github-app-token@v3`; Client ID = variable, private key = secret, nooit een opgeslagen token), fail-closed, `workflow_dispatch`. Aantoonbaar inert-met-duidelijke-melding zolang variable/private-key ontbreekt (buiten PR-gates, Lane A werkt door, Codex niet geblokkeerd).
3. **CAS full-swap bewezen:** onverwachte frontmatter-divergentie → re-read/recompute (nieuwe test groen); de oude veld-merge-test is weg; idempotente tak toetst volledige staat + invarianten.
4. **Nood-rebase:** drie expliciete SHA-rollen + merge-base/ancestry-check + `--force-with-lease`; dry-run bewezen.
5. **Coherentie-gate:** faalt aantoonbaar bij een geïntroduceerde tegenstrijdigheid (branch-mismatch of versiebotsing) en is groen bij consistente staat; draait in CI én lokale pre-flight.
6. **Alles consistent Sprint 14**; **geen** actieve native auto-merge; `npm run check` + Python-tests + architectuur-/release-/handoff-/PII-gates + Gemini groen. Geen deploy; geen productcode naar `main` buiten de PR.

## Overdracht
`handoff.md` → PR bij `READY_FOR_TEST` (Gemini + Lane A-gates), daarna `READY_FOR_VALIDATION` (Claude tegen ADR-0026 + ADR-0000 + deze criteria), dan `READY_FOR_INTEGRATION` (Mistral, **attended exact-SHA-merge**). De `p0a-admin-preflight` draait Bas handmatig vóór integratie. **Deploy nooit.** Bij twijfel/afwijking van een ADR: `BLOCKED` + `action_required_by: bas`.
