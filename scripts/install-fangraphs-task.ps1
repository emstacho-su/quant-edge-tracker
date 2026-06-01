# Registers a daily Windows Scheduled Task that refreshes the FanGraphs pitcher
# cache (scripts/scrape-fangraphs.mjs) into Supabase.
#
# A browser-login scrape must run locally (your residential IP + local .env.local
# credentials), so it cannot live on a Vercel cron or a remote Claude routine.
# Windows Task Scheduler is the right daily host.
#
# Install/update:  powershell -ExecutionPolicy Bypass -File scripts\install-fangraphs-task.ps1
# Remove:          Unregister-ScheduledTask -TaskName 'QuantEdge-FanGraphs' -Confirm:$false
# Run once now:    Start-ScheduledTask -TaskName 'QuantEdge-FanGraphs'

$ErrorActionPreference = 'Stop'
$taskName = 'QuantEdge-FanGraphs'
$projectRoot = (Resolve-Path "$PSScriptRoot\..").Path
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $projectRoot 'scripts\scrape-fangraphs.mjs'

if (-not (Test-Path (Join-Path $projectRoot '.env.local'))) {
  throw ".env.local not found in $projectRoot (needs FANGRAPHS_USER, FANGRAPHS_PASS, SUPABASE_SERVICE_ROLE_KEY)"
}

# Daily at 11:00 local. FanGraphs season-to-date is settled overnight, well before first pitch.
$argLine = '--env-file=.env.local "' + $script + '"'
$action = New-ScheduledTaskAction -Execute $node -Argument $argLine -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At 11:00am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Registered '$taskName' (daily 11:00)."
Write-Host "Runs: $node $argLine"
Write-Host "Working dir: $projectRoot"
Write-Host "Test now: Start-ScheduledTask -TaskName '$taskName'"
