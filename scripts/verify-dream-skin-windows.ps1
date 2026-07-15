param([int]$Port = 9341, [string]$Screenshot, [switch]$Reload)
. (Join-Path $PSScriptRoot 'common-windows.ps1')
Discover-Codex; Require-WindowsRuntime
$state = Read-State; if ($state -and -not $PSBoundParameters.ContainsKey('Port')) { $Port = [int]$state.port }
if (-not (Test-CodexEndpoint $Port)) { Fail "Port $Port is not a verified Codex loopback endpoint." }
$arguments = @($Injector, '--verify', '--port', $Port, '--theme-dir', $ThemeDir, '--timeout-ms', 30000)
if ($Screenshot) { $arguments += @('--screenshot', $Screenshot) }; if ($Reload) { $arguments += '--reload' }
& $Node @arguments
exit $LASTEXITCODE
