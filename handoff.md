---
sprint: 1
state: DEV_IN_PROGRESS
owner: codex
since: 2026-08-10T13:14:20Z
next: gemini
action_required_by: none
blocked: false
note: "Codex voert taak 10.2 uit op feat/sprint-1-t-run-ci-gates; private origin en GEMINI_API_KEY zijn vereist vóór READY_FOR_TEST."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Handmatige bootstrap (geen watchers).** Git-blokkade opgelost, zie ADR-0007: de repo is `Platform/ALV_Digitaal` zelf (niet VvE_Werk). Codex, doe als Git-steward eerst de repo-init, dan taak 10.2:

```powershell
# 1. Ruim het lege, misleidende .git-omhulsel op
Remove-Item -Recurse -Force "D:\Bas_en_AIs\VvE_Werk\.git"
# 2. Init de repo IN ALV_Digitaal (dit is de repo-root)
cd "D:\Bas_en_AIs\VvE_Werk\Platform\ALV_Digitaal"
git init -b main
# 3. Controleer .gitignore: geen mistral-lokaal/secure, out, .env, data, node_modules
git add -A ; git status
# 4. Eerste commit
git commit -m "chore: init ALV_Digitaal repo (fase 2) - architectuur, OTAP, ADR-0001..0007, pijplijn"
# 5. Privé GitHub-repo aanmaken + pushen (gh gebruikt het account dat ook HAOS-Werk beheert)
gh repo create ALV_Digitaal --private --source=. --remote=origin --push
#    Fallback zonder gh:
#    git remote add origin git@github.com:<account>/ALV_Digitaal.git ; git push -u origin main
```

Verifieer bij stap 3 dat `git status` géén `mistral-lokaal/secure/`, `mistral-lokaal/out/`, `.env` of `data/` toont (PII-discipline, ADR-0005). De commit bevat nu ook `.github/workflows/gemini-review.yml` (Gemini als PR-Action, ADR-0007). Daarna: `DEV_IN_PROGRESS` + taak 10.2, en werk als steward via **feature-branch → PR** (DEV→TEST loopt via een PR). **Bas** zet de repo-secret `GEMINI_API_KEY` (Settings → Secrets → Actions) vóór de eerste PR.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-10 — Claude: architectuur, OTAP, ADR-0001..0006, AGENTS/bijbel/sprint + agent-instructies opgezet. → READY_FOR_DEV.
- 2026-08-10 — Codex: BLOCKED — VvE_Werk/.git leeg, geen commits mogelijk.
- 2026-08-10 — Claude: gediagnosticeerd + ADR-0007 (repo = ALV_Digitaal). Git-init-commando's aangeleverd. → READY_FOR_DEV.
- 2026-08-10 — Codex aan zet: repo-init, daarna taak 10.2 (T-run + CI-gates).
