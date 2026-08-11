---
sprint: 3
state: READY_FOR_VALIDATION
owner: claude
since: 2026-08-11T13:10:18Z
next: mistral
action_required_by: claude
blocked: false
note: "Claude valideert PR #5; gates en Gemini zijn groen, echte acceptatiedeploy en hostchecks volgen in blok 4."
---

# handoff.md — de estafettestok

**Alleen de huidige `owner` schrijft dit bestand.** Statemachine, protocol en de 60s-race-guard staan in `AGENTS.md`. Houd `note` hierboven één zin; details in `progress.md`, waarheid in `bijbel.md`.

## Huidige beurt

**Sprint 3 — Acceptatie (10.3), blok 3 Claude.** Valideer PR #5 tegen ADR-0002/0003/0005/0012/0013, met herstelprocedure en de hieronder genoemde hostrisico's als harde aandachtspunten.

1. **Opgeleverd in PR #5:** doelgebonden `SECRETS_FILE`-bootstrap buiten app/webroot, vaste DB-coördinaten en sql_mode, database-afhankelijke `/healthz`, veilige code-only deploy met rollback, strikte SSH-hostkeycontrole en handmatige A/P-workflows met dubbele productiepoort.
2. **Bewijs:** 57/57 tests, architectuur-/release-/PII-gates, Linux Bash-syntax, droge A/P-runs en tijdelijke MariaDB 11.8-bootstrap groen; GitHub gates + Gemini groen.
3. **Nog echt te verifiëren:** LiteSpeed overschrijft `X-Forwarded-For` single-hop; Passenger krijgt `SECRETS_FILE`; GitHub secrets/variables en Environment-reviewer Bas staan goed; deploy tijdens een open stemronde blijft een operationele no-go. Er is nog geen echte A-deploy uitgevoerd.

Bas doet parallel de DirectAdmin-/SSH-/secrets-`.env`-/echte-export-stappen uit `sprint.md`.

## Beurt-log (kort; volledig verslag in progress.md)

- 2026-08-11 — Codex: Sprint 3 blok 0+1 op PR #5; acceptatie/CD-config, SSH-hardening en Gemini-5xx-backoff; gates + Gemini groen. → READY_FOR_VALIDATION (Claude).
- 2026-08-11 — Codex: PR #4 gemerged (`8dc939a`). Sprint 2 compleet.
- 2026-08-11 — Claude: Sprint 2 afgerond; Bas koos Sprint 3 = 10.3 A-domein. → READY_FOR_DEV (blok 0+1 Codex).
