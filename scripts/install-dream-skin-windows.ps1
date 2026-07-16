param([int]$Port = 9341, [switch]$NoLaunchers, [switch]$NoLaunch, [switch]$InPlace)
. (Join-Path $PSScriptRoot 'common-windows.ps1')
if ($Port -lt 1024 -or $Port -gt 65535) { Fail 'Port must be between 1024 and 65535.' }

if (-not $InPlace -and $ProjectRoot -ne $InstallRoot) {
  if (Test-Path -LiteralPath $StatePath) { Stop-RecordedInjector }
  $temporary = "$InstallRoot.installing.$PID"
  Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $temporary -Force | Out-Null
  Copy-Item -Path (Join-Path $ProjectRoot '*') -Destination $temporary -Recurse -Force
  Get-ChildItem -LiteralPath $ProjectRoot -Force | Where-Object { $_.Name -like '.*' -and $_.Name -ne '.git' } | Copy-Item -Destination $temporary -Recurse -Force
  Get-ChildItem -LiteralPath $temporary -Recurse -Force | Where-Object { $_.Name -like '._*' } | Remove-Item -Force
  $installedNode = Join-Path $InstallRoot 'runtime\node.exe'
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $installedNode } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
    Wait-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
  Move-Item -LiteralPath $temporary -Destination $InstallRoot
  & (Join-Path $InstallRoot 'scripts\install-dream-skin-windows.ps1') -Port $Port -NoLaunchers:$NoLaunchers -NoLaunch:$NoLaunch -InPlace
  exit $LASTEXITCODE
}

Discover-Codex
Require-WindowsRuntime
Ensure-StateRoot
if (-not (Test-Path -LiteralPath $ConfigPath)) { Fail "Codex config not found: $ConfigPath. Launch Codex once, close it, and rerun the installer." }
& $Node $Injector --check-payload --theme-dir $ThemeDir | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Theme payload validation failed.' }
& $Node (Join-Path $ScriptDir 'theme-config.mjs') install $ConfigPath $ThemeBackupPath
if ($LASTEXITCODE -ne 0) { Fail 'Could not save the Codex base theme.' }

if (-not $NoLaunchers) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  @(
    'Codex SkinKit - Customize.cmd',
    'Codex SkinKit - Switch Theme.cmd',
    'Codex SkinKit - Verify.cmd',
    'Codex SkinKit - Restore.cmd'
  ) | ForEach-Object { Remove-Item -LiteralPath (Join-Path $desktop $_) -Force -ErrorAction SilentlyContinue }
  $target = Join-Path $desktop 'Codex SkinKit.cmd'
  $content = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$InstallRoot\scripts\control-center-windows.ps1`" -Port $Port`r`nif errorlevel 1 pause`r`n"
  [IO.File]::WriteAllText($target, $content, [Text.UTF8Encoding]::new($false))
}
Write-Host "Codex SkinKit $SkinVersion (Windows build $WindowsBuild) installed at $InstallRoot for Codex $CodexVersion using signed Node.js $NodeVersion."
if (-not $NoLaunch) { & (Join-Path $ScriptDir 'start-dream-skin-windows.ps1') -Port $Port -PromptRestart }
