# Lokale watchers starten (attended proef → onbemand)

De watchers draaien lokaal in de terminal. Gemini heeft géén watcher (die is een GitHub Action). Je start dus drie watchers: **Codex, Claude, Mistral**, elk in een eigen PowerShell-venster, vanuit de repo-root.

## Vooraf (eenmalig)

1. **Config invullen:** `mistral-lokaal/secure/autorun.config.ps1` bevat de drie `ALV_AUTORUN_*_ARGV`. Controleer dat de CLI's lokaal geïnstalleerd én ingelogd zijn: Codex (`codex`), Claude Code (`claude`), Node (voor Mistral). Test elk runnercommando eerst los.
2. **Notifier:** `mistral-lokaal/secure/notifier.env` ingevuld (mail/ntfy), zodat je bij `BLOCKED`/klaar een seintje krijgt.
3. **Kill-switch kennen:** pauzeren = `New-Item autorun.paused -ItemType File -Force`; hervatten = `Remove-Item .\autorun.paused`. `Ctrl+C` stopt één watcher + zijn runner.
4. **Formele bot-approval toestaan:** GitHub → Settings → Actions → General → Workflow permissions → vink **Allow GitHub Actions to create and approve pull requests** aan. Zonder deze repository-instelling stopt de Gemini-workflow veilig rood en kan de auto-advance niet mergen.
5. **Auto-advance-switch:** repo-variabele `PIPELINE_AUTOMERGE` (GitHub → Settings → Secrets and variables → Actions → Variables). **Laat 'm eerst UIT** en merge de eerste PR handmatig; zet 'm op `on` zodra je de keten zichzelf wilt laten doorzetten.

## Starten — drie vensters, elk vanuit `Platform\ALV_Digitaal`

In **elk** venster eerst de config laden:

```powershell
cd D:\Bas_en_AIs\VvE_Werk\Platform\ALV_Digitaal
. .\mistral-lokaal\secure\autorun.config.ps1
```

Venster 1 (Codex):
```powershell
python scripts\watch_handoff.py --role codex --autorun --max-turns 1
```
Venster 2 (Claude):
```powershell
python scripts\watch_handoff.py --role claude --autorun --max-turns 1
```
Venster 3 (Mistral):
```powershell
python scripts\watch_handoff.py --role mistral --autorun --max-turns 1
```

Venster 4 (meekijken):
```powershell
powershell -ExecutionPolicy Bypass -File scripts\status.ps1 -Html -Watch
```
Open daarna `status.html` in de browser.

## Wat je ziet gebeuren

De baton loopt: **Codex** (bouwt, opent PR, `READY_FOR_TEST`) → GitHub draait CI + Gemini-review → **auto-advance-Action** merget en zet `READY_FOR_VALIDATION` (alleen als `PIPELINE_AUTOMERGE=on` én groen+approved) → **Claude** valideert → `READY_FOR_INTEGRATION` → **Mistral** integreert → `SPRINT_DONE` (notifier → jij). Elke watcher doet met `--max-turns 1` precies één beurt en stopt.

- **Deploy blijft altijd mens** — ook onbemand krijg je een seintje en druk jij.
- **Attended eerst:** kijk de eerste cyclus helemaal uit. Groen en gedrag zoals verwacht? Dan verhoog je `--max-turns` (of laat je de watchers doorlopen) richting je 24-uursrun.
- Iets geks? `New-Item autorun.paused -Force` bevriest alles direct.
