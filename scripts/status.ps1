param(
  [switch]$Html,
  [switch]$Watch,
  [int]$RefreshSeconds = 20
)

# status.ps1 - lokaal meekijkdashboard voor handoff, autorun, Git en PR-checks.
# Terminal: powershell -ExecutionPolicy Bypass -File scripts\status.ps1
# Browser:  powershell -ExecutionPolicy Bypass -File scripts\status.ps1 -Html -Watch
# Continu:  while ($true) { Clear-Host; powershell -ExecutionPolicy Bypass -File scripts\status.ps1; Start-Sleep 20 }

try { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8 } catch {}
if ($RefreshSeconds -lt 5) { throw "RefreshSeconds moet minimaal 5 zijn" }

$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
$repoGit = ($repo -replace '\\','/')
$pausePath = Join-Path $repo 'autorun.paused'
$runtimePath = Join-Path $repo 'autorun-status.json'
$activityPath = Join-Path $repo 'autorun.log'
$htmlPath = Join-Path $repo 'status.html'

$existing = @(git config --global --get-all safe.directory 2>$null)
if ($existing -notcontains $repoGit) {
  git config --global --add safe.directory $repoGit | Out-Null
}

function Git-Q { param([string[]]$GitArgs) & git @GitArgs 2>$null }
function Html-E { param([object]$Value) [Net.WebUtility]::HtmlEncode([string]$Value) }

function Read-Frontmatter {
  $values = [ordered]@{}
  $inside = $false
  foreach ($line in (Get-Content (Join-Path $repo 'handoff.md') -Encoding UTF8)) {
    if ($line.Trim() -eq '---') {
      if ($inside) { break }
      $inside = $true
      continue
    }
    if ($inside -and $line.Contains(':')) {
      $parts = $line.Split(':', 2)
      $values[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
    }
  }
  return $values
}

function Get-CheckSummary {
  param([object[]]$Checks)
  if (-not $Checks -or $Checks.Count -eq 0) { return 'GEEN CHECKS' }
  $states = @($Checks | ForEach-Object {
    if ($_.conclusion) { ([string]$_.conclusion).ToUpperInvariant() }
    elseif ($_.state) { ([string]$_.state).ToUpperInvariant() }
    elseif ($_.status) { ([string]$_.status).ToUpperInvariant() }
  })
  if ($states | Where-Object { $_ -match 'FAIL|ERROR|CANCEL|TIMED_OUT|ACTION_REQUIRED' }) { return 'ROOD' }
  if ($states | Where-Object { $_ -match 'PENDING|QUEUED|IN_PROGRESS|EXPECTED|WAITING' }) { return 'LOOPT' }
  if ($states | Where-Object { $_ -match 'SUCCESS|PASS|COMPLETED|NEUTRAL|SKIPPED' }) { return 'GROEN' }
  return 'ONBEKEND'
}

$handoff = Read-Frontmatter
$branch = [string](Git-Q @('rev-parse','--abbrev-ref','HEAD'))
$dirty = @(Git-Q @('status','--porcelain'))
$commits = @(Git-Q @('log','--oneline','-8'))
$progress = @(Get-Content (Join-Path $repo 'progress.md') -Encoding UTF8 -Tail 6)
$paused = Test-Path $pausePath
$activities = if (Test-Path $activityPath) { @(Get-Content $activityPath -Encoding UTF8 -Tail 10) } else { @() }

$runtime = $null
if (Test-Path $runtimePath) {
  try { $runtime = Get-Content $runtimePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $runtime = $null }
}
$runtimeAlive = $false
if ($runtime -and $runtime.running -eq $true -and $runtime.pid) {
  $runtimeAlive = $null -ne (Get-Process -Id ([int]$runtime.pid) -ErrorAction SilentlyContinue)
}

$prs = @()
$ghState = 'gh niet beschikbaar'
if (Get-Command gh -ErrorAction SilentlyContinue) {
  $prJson = & gh pr list --state open --limit 8 --json number,title,headRefName,statusCheckRollup,url 2>$null
  if ($LASTEXITCODE -eq 0) {
    $ghState = 'verbonden'
    if ($prJson) {
      try {
        $parsedPrs = $prJson | ConvertFrom-Json
        $prs = @($parsedPrs | Where-Object { $null -ne $_ -and $null -ne $_.number })
      } catch { $ghState = 'ongeldige gh-uitvoer' }
    }
  } else {
    $ghState = 'gh niet verbonden'
  }
}

$autorunLabel = 'UIT'
if ($paused) { $autorunLabel = 'GEPAUZEERD (kill-switch actief)' }
elseif ($runtimeAlive) { $autorunLabel = "AAN - rol=$($runtime.role), beurt=$($runtime.turns)/$($runtime.max_turns), pid=$($runtime.pid)" }
elseif ($runtime -and $runtime.running -eq $true) { $autorunLabel = 'GESTOPT/VEROUDERDE RUNTIME-STATE' }

Write-Host "=== HANDOFF ===" -ForegroundColor Cyan
foreach ($key in $handoff.Keys) { Write-Host ("  {0,-19}: {1}" -f $key, $handoff[$key]) }

Write-Host "`n=== AUTORUN ===" -ForegroundColor Cyan
$autorunColor = if ($paused) { 'Yellow' } elseif ($runtimeAlive) { 'Green' } else { 'Gray' }
Write-Host "  status             : $autorunLabel" -ForegroundColor $autorunColor
if ($runtime) {
  Write-Host "  gestart            : $($runtime.started_at)"
  Write-Host "  laatste beurt      : $($runtime.last_turn_at)"
  Write-Host "  laatst bijgewerkt  : $($runtime.updated_at)"
}

Write-Host "`n=== GIT ===" -ForegroundColor Cyan
Write-Host "  branch             : $branch"
if ($dirty.Count -gt 0 -and $dirty[0]) { Write-Host "  status             : $($dirty.Count) ongecommitte wijziging(en)" -ForegroundColor Yellow }
else { Write-Host "  status             : schoon (niets ongecommit)" -ForegroundColor Green }
Write-Host "  laatste commits:"
$commits | ForEach-Object { Write-Host "    $_" }

Write-Host "`n=== OPEN PR'S / CHECKS ($ghState) ===" -ForegroundColor Cyan
if ($prs.Count -eq 0) { Write-Host "  geen open PR's gevonden" }
foreach ($pr in $prs) {
  $summary = Get-CheckSummary @($pr.statusCheckRollup)
  Write-Host ("  #{0} [{1}] {2} ({3})" -f $pr.number, $summary, $pr.title, $pr.headRefName)
}

Write-Host "`n=== AUTORUN-ACTIVITEIT (laatste 10) ===" -ForegroundColor Cyan
if ($activities.Count -eq 0) { Write-Host "  nog geen autorun-activiteiten" }
else { $activities | ForEach-Object { Write-Host "  $_" } }

Write-Host "`n=== PROGRESS (laatste regels) ===" -ForegroundColor Cyan
$progress | ForEach-Object { Write-Host "  $_" }

if ($Html) {
  $prRows = if ($prs.Count -eq 0) {
    '<tr><td colspan="4">Geen open PR''s gevonden.</td></tr>'
  } else {
    ($prs | ForEach-Object {
      $summary = Get-CheckSummary @($_.statusCheckRollup)
      '<tr><td><a href="{0}">#{1}</a></td><td class="{2}">{3}</td><td>{4}</td><td>{5}</td></tr>' -f (Html-E $_.url), (Html-E $_.number), $summary.ToLowerInvariant(), (Html-E $summary), (Html-E $_.title), (Html-E $_.headRefName)
    }) -join "`n"
  }
  $handoffRows = ($handoff.Keys | ForEach-Object { "<tr><th>$(Html-E $_)</th><td>$(Html-E $handoff[$_])</td></tr>" }) -join "`n"
  $activityText = if ($activities.Count) { $activities -join "`n" } else { 'Nog geen autorun-activiteiten.' }
  $progressText = $progress -join "`n"
  $commitText = $commits -join "`n"
  $generated = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss K')
  $document = @"
<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta http-equiv="refresh" content="$RefreshSeconds">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ALV Digitaal - autorunstatus</title>
<style>
body{font-family:Segoe UI,Arial,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px}main{max-width:1100px;margin:auto}h1{margin-top:0}section{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px;margin:14px 0}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:7px;border-bottom:1px solid #334155}th{width:190px;color:#94a3b8}pre{white-space:pre-wrap;word-break:break-word}.groen{color:#4ade80}.rood{color:#fb7185}.loopt{color:#facc15}.muted{color:#94a3b8}a{color:#7dd3fc}
</style></head><body><main>
<h1>ALV Digitaal - autorunstatus</h1><p class="muted">Gegenereerd: $(Html-E $generated) - vernieuwt elke $RefreshSeconds seconden</p>
<section><h2>Handoff</h2><table>$handoffRows</table></section>
<section><h2>Autorun</h2><p><strong>$(Html-E $autorunLabel)</strong></p><p class="muted">Gestart: $(Html-E $runtime.started_at) | Laatste beurt: $(Html-E $runtime.last_turn_at) | Update: $(Html-E $runtime.updated_at)</p></section>
<section><h2>Open PR's en checks</h2><table><tr><th>PR</th><th>Checks</th><th>Titel</th><th>Branch</th></tr>$prRows</table><p class="muted">GitHub CLI: $(Html-E $ghState)</p></section>
<section><h2>Autorun-activiteiten</h2><pre>$(Html-E $activityText)</pre></section>
<section><h2>Git</h2><p>Branch: <strong>$(Html-E $branch)</strong> | Ongecommit: $($dirty.Count)</p><pre>$(Html-E $commitText)</pre></section>
<section><h2>Progress</h2><pre>$(Html-E $progressText)</pre></section>
</main></body></html>
"@
  [IO.File]::WriteAllText($htmlPath, $document, (New-Object Text.UTF8Encoding($false)))
  Write-Host "`nHTML-dashboard bijgewerkt: $htmlPath" -ForegroundColor Green
}

if ($Html -and $Watch) {
  Write-Host "Dashboard-watch actief; Ctrl+C stopt alleen het verversen." -ForegroundColor Cyan
  while ($true) {
    Start-Sleep -Seconds $RefreshSeconds
    & $PSCommandPath -Html -RefreshSeconds $RefreshSeconds
  }
}
