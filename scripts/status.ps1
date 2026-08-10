# status.ps1 - snel overzicht van de pijplijn-voortgang.
# Gebruik vanuit de repo:  powershell -File scripts\status.ps1
# Continu (elke 20s):      while ($true) { Clear-Host; powershell -File scripts\status.ps1; Start-Sleep 20 }

# --- UTF-8 forceren zodat -, . en -> netjes tonen (geen mojibake) ---
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
$repoGit = ($repo -replace '\\','/')

# --- safe.directory-uitzondering éénmalig zetten (voorkomt 'dubious ownership' fatals) ---
$existing = @(git config --global --get-all safe.directory 2>$null)
if ($existing -notcontains $repoGit) {
  git config --global --add safe.directory $repoGit | Out-Null
}

function Git-Q { param($args) & git @args 2>$null }

Write-Host "=== HANDOFF (state) ===" -ForegroundColor Cyan
$lines = Get-Content handoff.md -Encoding UTF8
$dash = 0
foreach ($l in $lines) {
  if ($l -eq '---') { $dash++; if ($dash -eq 2) { break }; continue }
  if ($dash -eq 1) { Write-Host "  $l" }
}

Write-Host "`n=== GIT ===" -ForegroundColor Cyan
Write-Host ("  branch : " + (Git-Q @('rev-parse','--abbrev-ref','HEAD')))
$dirty = Git-Q @('status','--porcelain')
if ($dirty) { Write-Host ("  status : " + (@($dirty).Count) + " ongecommitte wijziging(en)") -ForegroundColor Yellow }
else        { Write-Host "  status : schoon (niets ongecommit)" -ForegroundColor Green }

Write-Host "`n  laatste commits:"
Git-Q @('log','--oneline','-8') | ForEach-Object { Write-Host "    $_" }

Write-Host "`n=== PROGRESS (laatste regels) ===" -ForegroundColor Cyan
Get-Content progress.md -Encoding UTF8 -Tail 6 | ForEach-Object { Write-Host "  $_" }
