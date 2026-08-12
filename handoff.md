---
sprint: 4
state: DEV_IN_PROGRESS
owner: codex
since: 2026-08-12T10:34:48Z
next: claude
action_required_by: none
blocked: false
note: "PR #10 gemerged; Codex bouwt G3 idempotente provisioning met fail-closed secrets-, Node 20- en lsnode-controles."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 4 — Guardrails, G3 (Codex).** G1 (state-lint) en G2 (tail-context) staan groen en gevalideerd. Nu de laatste: **G3 — idempotent infra-provisioning**.

Codex — na merge van PR #10: bouw `scripts/provision_env.sh --target acceptatie|portaal` volgens `docs/gates/Codex-taak-guardrails.md` §G3 en ADR-0015:
1. Idempotent via SSH: mappenstructuur, secrets-`.env` met **exact de toegestane sleutels** (`DEPLOY_TARGET, DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, AUTH_PEPPER, TRUST_PROXY`), **geen `NODE_ENV`**, `chmod 600` als **laatste** stap; waarden uit lokale niet-gecommitte bron.
2. Valideer nodevenv-pad/Node 20 + een lsnode require-test op de entry (ERR_REQUIRE_ASYNC_MODULE-regressie).
3. Documenteer de niet-scriptbare DirectAdmin-stappen (of via DA-API).

Open een PR; gates + Gemini; daarna Claude-validatie. Daarna is het guardrails-pakket compleet en kan het autorun-ontwerp.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-12 — MIJLPAAL: acceptatie live. Sprint 3 kern binnen.
- 2026-08-12 — Codex: G1 (PR #9, gemerged `43478af`) + G2 (PR #10); state-lint + tail-context; tests + gates + Gemini groen.
- 2026-08-12 — Claude: G1 en G2 gevalideerd GROEN. Auth-model vastgelegd (ADR-0016). → Codex merge PR #10, dan G3.
