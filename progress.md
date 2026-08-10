# progress.md — werkverslag

Bevat deze sprint en de vorige. Oudere sprints worden ingekort naar één regel. Waarheid in `bijbel.md`; regels in `AGENTS.md`.

## Sprint 1 — Fundament (loopt)

**Doel:** T-omgeving draait, CI-gates groen. Zie `sprint.md`.

**Verslag:**
- 2026-08-10 · Claude · Architectuur- en besturingslaag opgezet: `OTAP_opzet_v1.0.0.md`, ADR-0004/0005/0006, Mistral-runbook, Codex-taak-10.2, en de pijplijnbestanden `AGENTS.md` / `bijbel.md` / `sprint.md` / `handoff.md` / `progress.md` + referentie-watcher `scripts/watch_handoff.py`. Fase-1 `stem.honigfabriek.nl` → onderhoudspagina.
- 2026-08-10 · Bas · Mistral Lokaal fase A+B afgerond: Ollama 0.32.6, `mistral-nemo:latest` (12,2B Q4_0), GPU-resident, veilige mappen.
- 2026-08-10 · Claude · Agent-instructies rond: `docs/gates/Codex-instructie.md`, `Gemini-instructie.md`, `Mistral-instructie.md` (incl. fase C) + A-domein-taak `Codex-Mistral-taak-10.3_A-domein.md`. README omgebouwd tot enige ingang; regel vastgelegd dat alleen Claude README/bijbel wijzigt.
- 2026-08-10 · Codex · BLOCKED: `D:\Bas_en_AIs\VvE_Werk\.git` leeg (geen HEAD/config) — geen git-operaties mogelijk. Protocol correct gevolgd, geen productcode gewijzigd.
- 2026-08-10 · Claude · Diagnose: VvE_Werk was nooit een repo; agent-topologie gemengd (Codex/Claude/Mistral lokaal, Gemini cloud). Besluit ADR-0007: repo = `ALV_Digitaal` zelf, lokaal trio deelt map. Remote = **privé GitHub-repo `ALV_Digitaal`** (net als HAOS-Werk); Gemini krijgt directe toegang via zijn GitHub-connector. Git-init + `gh repo create`-commando's aan Codex geleverd; `handoff.md` → `READY_FOR_DEV`.
- 2026-08-10 · Claude · Gemini heeft geen connector → opgenomen als **GitHub Action op PR** (`.github/workflows/gemini-review.yml`, met PII-voorwacht vóór externe API-verzending). DEV→TEST loopt nu via een Pull Request. ADR-0007 + bijbel + AGENTS + Gemini-charter bijgewerkt. Actie Bas: repo-secret `GEMINI_API_KEY` instellen vóór de eerste PR.
- 2026-08-10 · Codex · Taak 10.2 op `feat/sprint-1-t-run-ci-gates` (`af14f3a`): T-run met MariaDB 11.8.8, 120 synthetische deelnemers, strict SQL-mode/UTC, 2 GB/2 CPU en één Node-proces; 7/7 tests, gates A+B en code-only artefact groen; k6 1.783 requests, 0,00% fouten, status-p95 3,56 ms, vote-p95 17,15 ms. → READY_FOR_TEST via PR.

## Sprint 0 — Architectuur (afgerond, samengevat)

Architectuurvoorstel v0.2.0 met vier-AI-gatemodel, ADR-0001..0003 (Docker-alleen-dev/test, zes shared-hosting-regels, MariaDB 11.8.8 bevestigd), Docker-scaffold en deploy-scriptvoorzet. Basis voor de OTAP-opzet.
