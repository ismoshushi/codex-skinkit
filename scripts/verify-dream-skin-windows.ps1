param(
  [int]$Port = 9341,
  [string]$Screenshot,
  [switch]$Reload,
  [switch]$OpenThemePicker,
  [switch]$TestAllEffects,
  [switch]$TestThemeStudio,
  [switch]$TestReducedMotion,
  [switch]$TestSystemDefault
)
. (Join-Path $PSScriptRoot 'common-windows.ps1')
Discover-Codex; Require-WindowsRuntime
$state = Read-State; if ($state -and -not $PSBoundParameters.ContainsKey('Port')) { $Port = [int]$state.port }
if (-not (Test-CodexEndpoint $Port)) { Fail "Port $Port is not a verified Codex loopback endpoint." }
$mode = if ($TestAllEffects) { '--test-all-effects' }
  elseif ($TestThemeStudio) { '--test-theme-studio' }
  elseif ($TestReducedMotion) { '--test-reduced-motion' }
  elseif ($TestSystemDefault) { '--test-system-default' }
  else { '--verify' }
$arguments = @($Injector, $mode, '--port', $Port, '--theme-dir', $ThemeDir, '--timeout-ms', 120000)
if ($Screenshot) { $arguments += @('--screenshot', $Screenshot) }
if ($Reload) { $arguments += '--reload' }
if ($OpenThemePicker) { $arguments += '--open-theme-picker' }
& $Node @arguments
exit $LASTEXITCODE
