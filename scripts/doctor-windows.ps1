param([switch]$RequireLive)
. (Join-Path $PSScriptRoot 'common-windows.ps1')
Discover-Codex; Require-WindowsRuntime
if (-not (Test-Path -LiteralPath $ConfigPath)) { Fail "Codex config not found: $ConfigPath" }
foreach ($required in @('assets\dream-skin.css','assets\renderer-inject.js','assets\theme.json','scripts\injector.mjs')) { if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $required))) { Fail "Missing required file: $required" } }
$payload = & $Node $Injector --check-payload --theme-dir $ThemeDir | ConvertFrom-Json
$state = Read-State; $port = if ($state) { [int]$state.port } else { 9341 }; $live = $false
if ($state -and (Test-CodexEndpoint $port)) { & $Node $Injector --verify --port $port --theme-dir $ThemeDir --timeout-ms 12000 | Out-Null; $live = $LASTEXITCODE -eq 0 }
if ($RequireLive -and -not $live) { Fail 'No verified live SkinKit session is active.' }
[ordered]@{ pass=$true; product='Codex SkinKit'; version=$SkinVersion; windowsBuild=$WindowsBuild; platform="win32-$env:PROCESSOR_ARCHITECTURE"; codexVersion=$CodexVersion; packagePublisher=$CodexPackage.Publisher; nodeVersion=$NodeVersion; officialPackageUntouched=$true; modifiesAppAsar=$false; live=$live; port=$port; theme=@{ id=$payload.themeId; name=$payload.themeName; imageBytes=$payload.imageBytes; payloadBytes=$payload.payloadBytes } } | ConvertTo-Json -Depth 4
