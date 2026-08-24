# Codex-review — huidige staat ALV Digitaal

**Datum:** 24 augustus 2026  
**Type review:** statische, read-only projectreview  
**Beoordeelde branch:** `agent/sprint-13-cicd-p0a-fix1`  
**Beoordeelde commit:** `9243eec` (`fix(pipeline): fail closed on P0a live safety`)

## Samenvatting

De productbasis van ALV Digitaal oogt redelijk gezond: de repository is schoon, de testdekking is breed opgezet en de CI/CD-wijzigingen bevatten meerdere zinvolle veiligheidsverbeteringen. De huidige Sprint 13-fix is echter **nog niet mergeklaar**.

De belangrijkste blokkade is dat de nieuwe CI-controle de branchbeveiliging van `main` probeert uit te lezen met de standaard `GITHUB_TOKEN`. Voor dat GitHub-endpoint is repositoryrecht **Administration: read** nodig, terwijl dit recht niet beschikbaar is via de instelbare workflowrechten van `GITHUB_TOKEN`. De controle zal daardoor naar verwachting met een autorisatiefout stoppen. Omdat de implementatie terecht fail-closed is, blijft de CI rood en kan de fix niet veilig doorstromen.

Daarnaast zijn er twee belangrijke betrouwbaarheidsproblemen: de CAS-afhandeling van `handoff.md` kan gegevens uit twee verschillende toestanden combineren, en de lokale veiligheidscontrole is volledig doorgeschoven naar CI terwijl de lokale GitHub-authenticatie ongeldig is. Daardoor kan de actuele GitHub-configuratie momenteel niet onafhankelijk worden bevestigd.

**Advies:** houd `PIPELINE_AUTOMERGE=off`, laat de pipeline in `DEV_IN_PROGRESS` en merge of deploy deze fix nog niet.

## Huidige stand

| Onderdeel | Beoordeling |
|---|---|
| Productbasis | Redelijk gezond op basis van statische inspectie |
| Working tree | Schoon |
| Actieve branch | `agent/sprint-13-cicd-p0a-fix1` |
| Baton | `DEV_IN_PROGRESS`, eigenaar `codex` |
| Oorspronkelijke P0a-wijziging | Voortijdig automatisch gemerged via PR #23 |
| Herstelfix | Nog niet mergeklaar |
| Automatisch mergen | Moet uit blijven |
| Live GitHub-status | Niet onafhankelijk geverifieerd; lokale authenticatie is ongeldig |
| Deploy | Niet uitvoeren |

## Bevindingen

### P0 — CI kan de vereiste branchbeveiliging niet uitlezen

In `.github/workflows/ci.yml` gebruikt de stap voor live P0a-mergeveiligheid `${{ github.token }}` om onder andere dit endpoint te raadplegen:

`repos/{owner}/{repo}/branches/main/protection/required_status_checks`

Volgens de officiële GitHub-documentatie vereist dit endpoint bij een fine-grained token het repositoryrecht **Administration: read**. De configureerbare rechten van de standaard `GITHUB_TOKEN` bevatten geen `administration`-recht. Het verzoek zal daarom naar verwachting een `403` opleveren. De guard behandelt dit nu terecht als een fout, maar dat betekent ook dat de CI niet groen kan worden met de huidige opzet.

**Aanbevolen oplossing:** voer deze controle uit in een vertrouwde workflow op de default branch die geen code uit de pull request uitvoert, of als begeleide beheer-preflight. Gebruik alleen indien nodig een minimaal bevoegde GitHub App of fine-grained token met Administration read. Stel een beheertoken niet bloot aan een workflow die door pull-requestcode kan worden beïnvloed.

Bronnen:

- [GitHub REST API — branch protection](https://docs.github.com/en/rest/branches/branch-protection)
- [GitHub Actions — workflow syntax en GITHUB_TOKEN-permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)

### P1 — CAS kan een semantisch gemengde baton opleveren

In `scripts/git_steward.py` vergelijkt de CAS-afhandeling bij een gelijktijdige wijziging vooral `state`, `owner` en `sprint`. Velden als `since`, `next` en `note` worden vervolgens deels uit de nieuwste versie behouden. Daardoor kan een nieuwe status/eigenaar worden gecombineerd met beschrijvende velden die nog bij de vorige toestand horen.

Dat voorkomt tekstverlies, maar verzwakt de baton als één atomair coördinatie-object. Het resultaat kan technisch geldig lijken en inhoudelijk toch tegenstrijdig zijn. De bijbehorende test legt dit gedrag momenteel zelfs als verwachting vast.

**Aanbevolen oplossing:** behandel iedere onverwachte wijziging van de frontmatter als een verloren race, lees opnieuw en bereken de overgang opnieuw. Voeg alleen append-only informatie uit `progress.md` samen. Controleer bij een reeds bereikt doel bovendien de volledige bedoelde toestand en invarianten, niet uitsluitend status, eigenaar en sprintnummer.

### P1 — De live veiligheidscontrole is niet onafhankelijk verifieerbaar

`scripts/watch_handoff.py` start de lokale setup-guard met `--defer-live-safety-to-ci`. De lokale uitvoering controleert daardoor niet zelf of:

- `PIPELINE_AUTOMERGE` exact `off` staat;
- de oude workflow `pipeline-autoadvance` handmatig is uitgeschakeld;
- strict branch protection voor `main` uitstaat.

De verificatie rust volledig op de CI-stap uit de P0-bevinding. Tegelijk is de lokale GitHub-authenticatie ongeldig, waardoor de actuele remote instellingen tijdens deze review niet onafhankelijk konden worden gecontroleerd.

**Aanbevolen oplossing:** herstel eerst de veilige verificatieroute. Laat een vertrouwde CI-workflow of een begeleide beheer-preflight de drie live voorwaarden bewijzen voordat de baton verdergaat.

### P2 — Sprint- en branchadministratie spreken elkaar tegen

`sprint.md` verwijst naar `agent/sprint-13-cicd-p0a`, terwijl `handoff.md` en `config/pipeline-sprint.json` de herstelbranch `agent/sprint-13-cicd-p0a-fix1` gebruiken.

Daarnaast is het uitgangspunt “één sprint = één pull request” feitelijk doorbroken: PR #23 is al gemerged en de herstelfix wordt nog steeds onder Sprint 13 uitgevoerd.

**Aanbevolen oplossing:** leg de gebeurtenis vast als expliciete incidentuitzondering of geef de herstelronde een eigen aanduiding, bijvoorbeeld Sprint 13R1 of Sprint 14. Maak daarna branchnaam, taakdocument, baton en configuratie weer consistent.

### P2 — Het nood-rebaseplan is nog niet uitvoeringsklaar

Het gegenereerde plan gebruikt globaal:

`git rebase --onto new_main_sha old_sha branch`

en een force-push met een placeholder voor de verwachte oude head. De betekenis van `old_sha` is onvoldoende scherp: het kan de oude basis van `main`, de merge-base of de oude branch-head betekenen. Zonder expliciete ancestrycontrole kan een uitvoerder de verkeerde commits herschrijven.

**Aanbevolen oplossing:** benoem afzonderlijk `old_main_base_sha`, `new_main_sha` en `expected_old_branch_head_sha`. Controleer vóór uitvoering de merge-base en voorouderrelaties. Vul vervolgens een exacte `--force-with-lease=<branch>:<expected-old-head>` in. Tot die tijd uitsluitend als dry-runadvies tonen.

## Positieve punten

- De werkbranch was tijdens de review schoon en gelijk aan de remote branch.
- De repository bevat brede testcategorieën voor onder meer backend, frontend, database, security, PII, deployment en pipelinegedrag.
- De PR-identificatie is verbeterd: PR-nummer is primair en zoeken op branch is secundair.
- De guards zijn op diverse plekken fail-closed gemaakt.
- De metadata zet native auto-merge uit.
- De release-tags gebruiken een apart `infra`-namespace, wat botsingen met productversies voorkomt.
- De veiligheidsincidenten en herstelwerkzaamheden zijn zichtbaar gedocumenteerd.

## Minimale voorwaarden voor vervolg

De fix kan pas opnieuw voor merge worden aangeboden wanneer ten minste aan deze voorwaarden is voldaan:

1. De live P0a-controle draait aantoonbaar met voldoende leesrechten in een vertrouwde context.
2. De controle bewijst dat auto-merge uitstaat, de oude workflow handmatig is uitgeschakeld en de gewenste branchinstelling klopt.
3. De CAS-overgang van `handoff.md` kan geen velden uit verschillende batonversies combineren.
4. Sprint-, branch- en PR-administratie zijn onderling consistent of de incidentuitzondering is expliciet vastgelegd.
5. Het nood-rebaseplan gebruikt eenduidige SHA-rollen en controleert de commitafstamming.
6. De relevante CI- en regressietests zijn na de aanpassingen opnieuw groen gedraaid.

## Reikwijdte en beperkingen van deze review

Deze beoordeling was uitdrukkelijk read-only. Er zijn geen product- of configuratiebestanden gewijzigd en er zijn geen tests opnieuw uitgevoerd, omdat tests lokale caches of tijdelijke bestanden kunnen aanmaken. De conclusies zijn gebaseerd op statische code-inspectie, repositorymetadata en reeds vastgelegde projectinformatie.

De live GitHub-instellingen konden niet onafhankelijk worden bevestigd doordat de lokaal beschikbare GitHub-authenticatie ongeldig was. Uitspraken over de actuele remote instellingen moeten daarom als onbevestigd worden behandeld totdat een bevoegde, vertrouwde controle ze opnieuw heeft uitgelezen.
