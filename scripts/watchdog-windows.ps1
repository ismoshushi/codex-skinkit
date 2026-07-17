. (Join-Path $PSScriptRoot 'common-windows.ps1')
Ensure-StateRoot

$mutex = [Threading.Mutex]::new($false, 'Local\CodexSkinKitWatchdog')
if (-not $mutex.WaitOne(0)) { exit 0 }

try {
  [IO.File]::WriteAllText($WatchdogPidPath, "$PID`n", [Text.UTF8Encoding]::new($false))
  $attempts = [Collections.Generic.List[datetime]]::new()
  while (Test-Path -LiteralPath $WatchdogEnabledPath) {
    try {
      Discover-Codex
      $running = @(Get-CodexMainProcesses).Count -gt 0
      $state = Read-State
      $port = if ($state -and $state.port) { [int]$state.port } else { 9341 }

      if ($running -and -not (Test-CodexRendererTarget $port)) {
        Start-Sleep -Seconds 3
        if (@(Get-CodexMainProcesses).Count -gt 0 -and -not (Test-CodexRendererTarget $port)) {
          $now = Get-Date
          for ($index = $attempts.Count - 1; $index -ge 0; $index--) {
            if (($now - $attempts[$index]).TotalMinutes -gt 10) { $attempts.RemoveAt($index) }
          }
          if ($attempts.Count -ge 3) {
            "$(Get-Date -Format o) Restart circuit open; waiting before another recovery attempt." | Add-Content -LiteralPath $WatchdogLog -Encoding utf8
            Start-Sleep -Seconds 60
            continue
          }
          $attempts.Add($now)
          "$(Get-Date -Format o) Restarting Codex once to restore the verified SkinKit endpoint." | Add-Content -LiteralPath $WatchdogLog -Encoding utf8
          Stop-Codex
          & (Join-Path $ScriptDir 'start-dream-skin-windows.ps1') -Port $port
        }
      } elseif ($running -and (Test-CodexRendererTarget $port)) {
        $injector = if ($state -and $state.injectorPid) { Get-CimInstance Win32_Process -Filter "ProcessId=$($state.injectorPid)" -ErrorAction SilentlyContinue } else { $null }
        if (-not $injector -or $injector.ExecutablePath -ne $state.nodePath -or $injector.CommandLine -notlike "*$($state.injectorPath)*--watch*") {
          & (Join-Path $ScriptDir 'start-dream-skin-windows.ps1') -Port $port
        }
      }
    } catch {
      "$(Get-Date -Format o) $($_.Exception.Message)" | Add-Content -LiteralPath $WatchdogErrorLog -Encoding utf8
      Start-Sleep -Seconds 10
    }
    Start-Sleep -Seconds 4
  }
} finally {
  Remove-Item -LiteralPath $WatchdogPidPath -Force -ErrorAction SilentlyContinue
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
