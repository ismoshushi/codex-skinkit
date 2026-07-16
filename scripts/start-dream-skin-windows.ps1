param([int]$Port = 9341, [switch]$RestartExisting, [switch]$PromptRestart)
. (Join-Path $PSScriptRoot 'common-windows.ps1')
Discover-Codex; Require-WindowsRuntime; Ensure-StateRoot
$state = Read-State
if ($state -and -not $PSBoundParameters.ContainsKey('Port')) { $Port = [int]$state.port }
$ready = Test-CodexEndpoint $Port
if (@(Get-CodexMainProcesses).Count -gt 0 -and -not $ready) {
  if ($PromptRestart -and -not $RestartExisting) {
    Add-Type -AssemblyName System.Windows.Forms
    $answer = [System.Windows.Forms.MessageBox]::Show('Codex needs to restart once to enable SkinKit.', 'Codex SkinKit', 'OKCancel', 'Information')
    if ($answer -ne 'OK') { Fail 'Theme launch was cancelled.' }
    $RestartExisting = $true
  }
  if (-not $RestartExisting) { Fail 'Codex is running without the verified skin endpoint. Close it or pass -RestartExisting.' }
  Stop-Codex
}
if (-not $ready) {
  $Port = Select-AvailablePort $Port
  Start-CodexDebugging $Port
  $deadline = (Get-Date).AddSeconds(35)
  while (-not (Test-CodexEndpoint $Port) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 400 }
  if (-not (Test-CodexEndpoint $Port)) { Fail "Codex did not expose a verified loopback CDP endpoint on port $Port." }
}
if ($state) { Stop-RecordedInjector }
$injectorProcess = Start-Process -FilePath $Node -ArgumentList @($Injector, '--watch', '--port', $Port, '--theme-dir', $ThemeDir) -RedirectStandardOutput $InjectorLog -RedirectStandardError $InjectorErrorLog -PassThru -WindowStyle Hidden
Start-Sleep -Milliseconds 800
if ($injectorProcess.HasExited) { Fail "The injector exited during startup. See $InjectorErrorLog" }
$main = Get-CodexMainProcesses | Select-Object -First 1
$newState = [ordered]@{ schemaVersion=4; platform="win32-$env:PROCESSOR_ARCHITECTURE"; skinVersion=$SkinVersion; port=$Port; injectorPid=$injectorProcess.Id; injectorPath=$Injector; nodePath=$Node; nodeVersion=$NodeVersion; codexExe=$CodexExe; codexVersion=$CodexVersion; codexPid=$main.ProcessId; projectRoot=$ProjectRoot; themeDir=$ThemeDir; createdAt=(Get-Date -Format o) }
$newState | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding utf8
& $Node $Injector --verify --port $Port --theme-dir $ThemeDir --timeout-ms 30000 | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-Process -Id $injectorProcess.Id -ErrorAction SilentlyContinue; Remove-Item $StatePath -Force; Fail 'Injection verification failed.' }
Write-Host "Codex SkinKit $SkinVersion is active on loopback port $Port."
