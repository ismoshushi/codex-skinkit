param([int]$Port = 9341, [switch]$RestoreBaseTheme, [switch]$RestartCodex, [switch]$Uninstall)
. (Join-Path $PSScriptRoot 'common-windows.ps1')
Discover-Codex; Require-WindowsRuntime; Ensure-StateRoot
$state = Read-State; if ($state -and -not $PSBoundParameters.ContainsKey('Port')) { $Port = [int]$state.port; Stop-RecordedInjector }
$running = @(Get-CodexMainProcesses).Count -gt 0; $ready = Test-CodexEndpoint $Port
if ($ready) { & $Node $Injector --remove --port $Port --theme-dir $ThemeDir --timeout-ms 8000 | Out-Null; if ($LASTEXITCODE -ne 0) { Fail 'The live skin could not be removed.' } }
elseif ($running -and -not $RestartCodex) { Fail 'Codex is running but its saved endpoint cannot be verified. Pass -RestartCodex.' }
if ($RestoreBaseTheme) { & $Node (Join-Path $ScriptDir 'theme-config.mjs') restore $ConfigPath $ThemeBackupPath; if ($LASTEXITCODE -ne 0) { Fail 'Base theme restore failed.' } }
if ($RestartCodex) { if ($running) { Stop-Codex }; Start-Process 'shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App' }
Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
if ($Uninstall) { Get-ChildItem ([Environment]::GetFolderPath('Desktop')) -Filter 'Codex SkinKit*.cmd' | Remove-Item -Force }
Write-Host 'Codex SkinKit was removed and the requested Windows restore actions completed.'
