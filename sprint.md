# sprint.md — Sprint 12: Git-hardening Stap 2 (watcher ↔ GitSteward + verfijningen)

**Doel:** de robuustheid van de GitSteward (Stap 1, op `main`) overal laten gelden. De `watch_handoff.py`-watcher delegeert zijn coördinatie-git + de **verplichte block-finalize** aan `git_steward.py`, en drie samenhangende context/protocol-verfijningen landen op dezelfde plek. Ontwerp: **ADR-0025**. Spec: **`docs/gates/Codex-taak-gitsteward-stap2.md`**.

> **Zelf-modificerend + attended.** Deze sprint wijzigt de watcher die de beurten zélf draait. Draai `--max-turns 1` met Bas erbij; één volledige begeleide beurt op de nieuwe watcher moet schoon + in-sync eindigen vóór je erop leunt. Niet onbemand.

## Cadans — per blok

| Blok | Rol | Watcher | Inhoud |
|---|---|---|---|
| 1 | **Codex** (dev) | `--role codex` | watcher→steward-delegatie + block-finalize + bijbel-trim + Codex-instructie + race-guard + schoon-exit; tests; PR |
| 2 | *auto* | — | CI-gates + Gemini-review op de PR |
| 3 | **Claude** (validatie) | `--role claude` | Toets tegen ADR-0025/0015 (block-finalize via steward, geen productcode naar main, context per rol) |
| 4 | **Mistral** (integratie) | `--role mistral` | Gates; geen deploy |

## Scope

- **In:** (1) watcher delegeert coördinatie-sync + verplichte block-finalize aan `git_steward.py`; (2) bijbel-context per rol trimmen (volle bijbel alleen voor Claude); (3) `Codex-instructie.md` → register + taakdoc + op-afroep i.p.v. "lees eerst de hele bijbel"; (4) dubbele race-guard weg (alleen de watcher houdt 'm); (5) schoon exit na `--max-turns` (`running:false`, geen na-idlen).
- **Uit (Stap 3+):** feature-branch-push + PR-creatie naar de steward (→ runners volledig offline); PR-gate/mergeroute wijzigen; deploy; productfunctionaliteit.

## Definition of done

- Block-finalize loopt via de steward (getest: blokkade → BLOCKED-baton+progress gecommit+gepusht, schone/in-sync tree); watcher doet zelf geen `git commit/push` op coördinatie meer.
- Context voor `codex`/`mistral` bevat níet de volledige bijbel maar wél register+rollen+versiebeheer+taakdoc; voor `claude` wél volledig — getest.
- Runner voert de 60s-guard niet dubbel uit; `--max-turns 1` eindigt met een gestopt proces (`running:false`).
- `npm run check` + Python-tests + architectuur-, release-, handoff- en PII-gates + Gemini-review groen; `test_watch_handoff.py` bijgewerkt. **Geen deploy; geen productcode naar `main`.**
- Eén begeleide beurt bewijst de nieuwe watcher schoon draait.

## Buiten scope

Deploy/productie · runners volledig offline (Stap 3) · nieuwe merge-route · onbemand/overnight zonder aparte Bas-go.
