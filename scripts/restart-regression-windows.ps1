param([int]$TimeoutSeconds = 100, [string]$ResultPath)
. (Join-Path $PSScriptRoot 'common-windows.ps1')
Discover-Codex
Ensure-StateRoot

if (-not (Test-Path -LiteralPath $WatchdogEnabledPath)) { Fail 'The SkinKit watchdog is not enabled.' }
Stop-Codex
Start-Process 'shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App'

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$result = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  $state = Read-State
  if ($state -and (Test-CodexRendererTarget ([int]$state.port))) {
    $main = Get-CodexMainProcesses | Select-Object -First 1
    $result = [ordered]@{
      pass = $true
      port = [int]$state.port
      codexPid = $main.ProcessId
      injectorPid = [int]$state.injectorPid
      recoveredAt = Get-Date -Format o
    }
    break
  }
}
if (-not $result) { $result = [ordered]@{ pass = $false; error = 'The watchdog did not restore a verified Codex renderer before timeout.' } }
$json = $result | ConvertTo-Json
if ($ResultPath) { [IO.File]::WriteAllText($ResultPath, "$json`n", [Text.UTF8Encoding]::new($false)) }
Write-Output $json
if (-not $result.pass) { exit 2 }
