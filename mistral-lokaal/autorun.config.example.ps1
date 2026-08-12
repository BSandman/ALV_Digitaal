# Voorbeeldconfig voor een begeleide autorun (ADR-0017).
# Kopieer dit bestand lokaal naar secure/autorun.config.ps1 en pas die kopie aan.
# De map secure/ wordt niet door Git gevolgd. Zet hier nooit tokens of wachtwoorden.

# Runnercommando's zijn JSON-arrays: elk argument blijft hierdoor exact gescheiden.
# Controleer het commando eerst handmatig; haal pas daarna het commentaarteken weg.
# $env:ALV_AUTORUN_CODEX_ARGV = '["codex", "exec", "-"]'
# $env:ALV_AUTORUN_CLAUDE_ARGV = '["PAD-NAAR-CLAUDE-RUNNER", "EEN-BEURT-OPTIE"]'
# $env:ALV_AUTORUN_MISTRAL_ARGV = '["PAD-NAAR-MISTRAL-RUNNER", "EEN-BEURT-OPTIE"]'

# Veilige attended-first defaults. CLI-opties mogen deze waarden per sessie overschrijven.
$env:ALV_AUTORUN_MAX_TURNS = '1'
$env:ALV_AUTORUN_MAX_WALLCLOCK_SECONDS = '900'
$env:ALV_AUTORUN_INTERVAL_SECONDS = '45'
$env:ALV_AUTORUN_PROGRESS_TAIL = '15'

# De notifier leest kanaal en geheimen uit het bestaande lokale notifier.env-bestand.
$env:ALV_NOTIFIER_CONFIG = (Join-Path $PSScriptRoot 'notifier.env')
