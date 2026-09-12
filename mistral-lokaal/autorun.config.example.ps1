# Voorbeeldconfig voor een begeleide autorun (ADR-0017).
# Kopieer dit bestand lokaal naar secure/autorun.config.ps1 en pas die kopie aan.
# De map secure/ wordt niet door Git gevolgd. Zet hier nooit tokens of wachtwoorden.

# Runnercommando's zijn JSON-arrays: elk argument blijft hierdoor exact gescheiden.
# Codex krijgt een schrijfbare workspace, geen vragen, geen blijvende sessie en alleen
# netwerktoegang binnen die sandbox voor de verplichte Git-push.
$env:ALV_AUTORUN_CODEX_ARGV = '["codex","exec","--sandbox","workspace-write","--ephemeral","--config","sandbox_workspace_write.network_access=true","-"]'

# Claude draait headless met een expliciete toolset. dontAsk weigert al het overige
# in plaats van tijdens een onbemande beurt een vraag te stellen.
$env:ALV_AUTORUN_CLAUDE_ARGV = '["claude","--print","--input-format","text","--output-format","text","--permission-mode","dontAsk","--tools","Read,Glob,Grep,Edit,Write,Bash","--allowedTools","Read,Glob,Grep,Edit,Write,Bash(git *),Bash(gh *),Bash(npm *),Bash(node *),Bash(python *)","--max-turns","20","--no-session-persistence"]'

# Mistral gebruikt geen agent-LLM voor control-flow: deze Node-runner is deterministisch.
$env:ALV_AUTORUN_MISTRAL_ARGV = '["node","mistral-lokaal/scripts/run_integration_turn.mjs","--stdin"]'

# Veilige attended-first defaults. CLI-opties mogen deze waarden per sessie overschrijven.
# Harde maxima: 20 beurten, 14.400 s wandklok, 3.600 s interval en 500 progress-regels.
$env:ALV_AUTORUN_MAX_TURNS = '1'
$env:ALV_AUTORUN_MAX_WALLCLOCK_SECONDS = '900'
$env:ALV_AUTORUN_INTERVAL_SECONDS = '45'
$env:ALV_AUTORUN_PROGRESS_TAIL = '15'

# De notifier leest kanaal en geheimen uit het bestaande lokale notifier.env-bestand.
$env:ALV_NOTIFIER_CONFIG = (Join-Path $PSScriptRoot 'notifier.env')
$env:ALV_NOTIFIER_STATE = (Join-Path $PSScriptRoot 'notifier-state.json')
