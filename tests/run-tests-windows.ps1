$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'scripts\common-windows.ps1')
Discover-Codex; Require-WindowsRuntime
if (@(Get-CodexMainProcesses).Count -lt 0) { throw 'Process discovery did not return an array-compatible result.' }
$entryPoints = @(Get-ChildItem -LiteralPath $root -File -Filter '*.cmd')
if ($entryPoints.Count -ne 1 -or $entryPoints[0].Name -ne 'Codex SkinKit.cmd') { throw 'The repository must expose one Codex SkinKit CMD entry point.' }
if (-not (Test-Path -LiteralPath (Join-Path $root 'scripts\control-center-windows.ps1'))) { throw 'The control center script is missing.' }
$switchScript = Get-Content -LiteralPath (Join-Path $root 'scripts\switch-theme-windows.ps1') -Raw -Encoding UTF8
if ($switchScript -like '*--port 9341*' -or $switchScript -like '*-Port 9341*') { throw 'Theme switching must use the active state port instead of a hard-coded port.' }
Get-ChildItem (Join-Path $root 'scripts') -Filter '*.ps1' | ForEach-Object { [void][scriptblock]::Create((Get-Content $_.FullName -Raw)) }
Get-ChildItem (Join-Path $root 'scripts'),(Join-Path $root 'assets') -Include '*.mjs','*.js' -Recurse | Where-Object { $_.Name -notlike '._*' } | ForEach-Object { & $Node --check $_.FullName | Out-Null; if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax failed: $($_.FullName)" } }
$renderer = Get-Content -LiteralPath (Join-Path $root 'assets\renderer-inject.js') -Raw -Encoding UTF8
$style = Get-Content -LiteralPath (Join-Path $root 'assets\dream-skin.css') -Raw -Encoding UTF8
foreach ($marker in @('SYSTEM_DEFAULT_ID', 'indexedDB.open', 'prepareUploadedImage', 'saveUploadedThemeRecord', 'dream-skin-theme-trigger')) {
  if ($renderer -notlike "*$marker*") { throw "In-app theme studio marker is missing: $marker" }
}
if ($style -notlike '*prefers-reduced-motion*') { throw 'Reduced-motion CSS handling is missing.' }
$basePayload = & $Node (Join-Path $root 'scripts\injector.mjs') --check-payload | ConvertFrom-Json
if (-not $basePayload.pass -or $basePayload.builtinThemeCount -ne 5) { throw 'Built-in theme registry payload validation failed.' }
$layouts = [Collections.Generic.HashSet[string]]::new()
$effects = [Collections.Generic.HashSet[string]]::new()
foreach ($profile in Get-ChildItem (Join-Path $root 'profiles') -Directory) {
  $profileConfig = Get-Content -LiteralPath (Join-Path $profile.FullName 'theme.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($profileConfig.schemaVersion -ne 1 -or -not $profileConfig.name -or -not $profileConfig.layout -or -not $profileConfig.effect) { throw "Theme profile metadata failed UTF-8 parsing or capability validation: $($profile.Name)" }
  [void]$layouts.Add([string]$profileConfig.layout)
  [void]$effects.Add([string]$profileConfig.effect)
  & $Node (Join-Path $root 'scripts\injector.mjs') --check-payload --theme-dir $profile.FullName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Theme profile failed validation: $($profile.Name)" }
}
if ($layouts.Count -ne 3 -or $effects.Count -ne 4) { throw 'SkinKit must expose exactly three layout families and four effect profiles.' }
$tmp = Join-Path $env:TEMP "codex-skinkit-tests-$PID"; New-Item -ItemType Directory -Path (Join-Path $tmp 'theme') -Force | Out-Null
try {
  Copy-Item (Join-Path $root 'assets\open-portal.png') (Join-Path $tmp 'theme\background.png')
  & $Node (Join-Path $root 'scripts\write-theme.mjs') custom --output-dir (Join-Path $tmp 'theme') --image background.png --name 'Windows Test' --tagline 'Test' --quote 'TEST' --accent '#11aa55' --secondary '#22bbcc' --highlight '#663399' | Out-Null
  $payload = & $Node (Join-Path $root 'scripts\injector.mjs') --check-payload --theme-dir (Join-Path $tmp 'theme') | ConvertFrom-Json
  if (-not $payload.pass -or $payload.themeName -ne 'Windows Test') { throw 'Custom theme payload test failed.' }
  $config = Join-Path $tmp 'config.toml'; $backup = Join-Path $tmp 'backup.json'; $original = "model = `"gpt-5`"`n`n[desktop]`nappearanceTheme = `"system`"`nappearanceDarkCodeThemeId = `"vscode-dark`"`nkeepMe = true`n"
  [IO.File]::WriteAllText($config, $original); & $Node (Join-Path $root 'scripts\theme-config.mjs') install $config $backup | Out-Null; & $Node (Join-Path $root 'scripts\theme-config.mjs') restore $config $backup | Out-Null
  if ([IO.File]::ReadAllText($config) -ne $original) { throw 'Config round-trip test failed.' }
  & $Node (Join-Path $root 'scripts\theme-config.mjs') restore $config $backup | Out-Null
  if ($LASTEXITCODE -ne 0 -or [IO.File]::ReadAllText($config) -ne $original) { throw 'Repeated restore must be a no-op.' }
} finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host 'PASS: syntax, signed runtime, five-theme registry, three layouts, four effects, in-app studio, custom theme, and config round-trip.'
