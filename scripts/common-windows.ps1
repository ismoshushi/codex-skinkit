$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $PSCommandPath
$ProjectRoot = Split-Path -Parent $ScriptDir
$InstallRoot = Join-Path $HOME '.codex\codex-skinkit'
$StateRoot = Join-Path $env:LOCALAPPDATA 'CodexSkinKit'
$StatePath = Join-Path $StateRoot 'state.json'
$ThemeBackupPath = Join-Path $StateRoot 'theme-backup.json'
$ThemeDir = Join-Path $StateRoot 'theme'
$ProfilesRoot = Join-Path $ProjectRoot 'profiles'
$ConfigPath = Join-Path $HOME '.codex\config.toml'
$Injector = Join-Path $ScriptDir 'injector.mjs'
$InjectorLog = Join-Path $StateRoot 'injector.log'
$InjectorErrorLog = Join-Path $StateRoot 'injector-error.log'
$StartErrorLog = Join-Path $StateRoot 'start-error.log'
$RuntimeRoot = Join-Path $InstallRoot 'runtime'
$RuntimeNode = Join-Path $RuntimeRoot 'node.exe'
$SkinVersion = '1.0.0'
$WindowsBuild = '2026.07.16.1'

function Fail([string]$Message) {
  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
  "$(Get-Date -Format o) $Message" | Add-Content -LiteralPath $StartErrorLog -Encoding utf8
  throw "Codex SkinKit: $Message"
}

function Ensure-StateRoot {
  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
}

function Discover-Codex {
  $package = Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1
  if (-not $package) { Fail 'Could not find the official Microsoft Store Codex package (OpenAI.Codex).' }
  $script:CodexPackage = $package
  $script:CodexAppUserModelId = "$($package.PackageFamilyName)!App"
  $script:CodexVersion = $package.Version.ToString()
  $script:CodexExe = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
  $script:PackagedNode = Join-Path $package.InstallLocation 'app\resources\cua_node\bin\node.exe'
  if (-not (Test-Path -LiteralPath $CodexExe -PathType Leaf)) { Fail "Codex executable is missing: $CodexExe" }
  if (-not (Test-Path -LiteralPath $PackagedNode -PathType Leaf)) { Fail "Codex bundled Node.js is missing: $PackagedNode" }
}

function Start-CodexDebugging([int]$Port) {
  if (-not ('CodexSkinKit.ApplicationActivationManager' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace CodexSkinKit {
  [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IApplicationActivationManager {
    int ActivateApplication(string appUserModelId, string arguments, uint options, out uint processId);
    int ActivateForFile(string appUserModelId, IntPtr itemArray, string verb, out uint processId);
    int ActivateForProtocol(string appUserModelId, IntPtr itemArray, out uint processId);
  }

  [ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
  class ApplicationActivationManagerCom { }

  public static class ApplicationActivationManager {
    public static uint Activate(string appUserModelId, string arguments) {
      uint processId;
      var manager = (IApplicationActivationManager)new ApplicationActivationManagerCom();
      int result = manager.ActivateApplication(appUserModelId, arguments, 0, out processId);
      if (result < 0) Marshal.ThrowExceptionForHR(result);
      return processId;
    }
  }
}
'@
  }
  [void][CodexSkinKit.ApplicationActivationManager]::Activate(
    $CodexAppUserModelId,
    "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$Port"
  )
}

function Require-WindowsRuntime {
  if (-not $CodexPackage.Publisher.StartsWith('CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B', [StringComparison]::OrdinalIgnoreCase)) {
    Fail "Unexpected Codex package publisher: $($CodexPackage.Publisher)"
  }
  $nodeSignature = Get-AuthenticodeSignature -LiteralPath $PackagedNode
  if ($nodeSignature.Status -ne 'Valid') { Fail "Codex bundled Node.js signature is not valid: $($nodeSignature.Status)" }
  New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
  $sourceHash = (Get-FileHash -LiteralPath $PackagedNode -Algorithm SHA256).Hash
  $copyNeeded = -not (Test-Path -LiteralPath $RuntimeNode -PathType Leaf)
  if (-not $copyNeeded) { $copyNeeded = (Get-FileHash -LiteralPath $RuntimeNode -Algorithm SHA256).Hash -ne $sourceHash }
  if ($copyNeeded) { Copy-Item -LiteralPath $PackagedNode -Destination $RuntimeNode -Force }
  if ((Get-FileHash -LiteralPath $RuntimeNode -Algorithm SHA256).Hash -ne $sourceHash) { Fail 'The user-local Node.js copy does not match the signed Codex runtime.' }
  if ((Get-AuthenticodeSignature -LiteralPath $RuntimeNode).Status -ne 'Valid') { Fail 'The user-local Node.js copy failed signature validation.' }
  $script:Node = $RuntimeNode
  $script:NodeVersion = (& $Node --version).Trim()
  $major = [int]($NodeVersion.TrimStart('v').Split('.')[0])
  if ($major -lt 20) { Fail "Codex bundled Node.js $NodeVersion is too old; version 20 or newer is required." }
}

function Get-CodexMainProcesses {
  @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'ChatGPT.exe' -and $_.ExecutablePath -eq $CodexExe -and $_.CommandLine -notmatch '--type='
  })
}

function Stop-Codex {
  Get-CodexMainProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
  $deadline = (Get-Date).AddSeconds(15)
  while (@(Get-CodexMainProcesses).Count -gt 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if (@(Get-CodexMainProcesses).Count -gt 0) { Fail 'Codex did not close within 15 seconds.' }
}

function Get-ListenerPid([int]$Port) {
  @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Test-CodexEndpoint([int]$Port) {
  try {
    $pids = @(Get-ListenerPid $Port)
    if ($pids.Count -lt 1) { return $false }
    foreach ($pidValue in $pids) {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue"
      if (-not $process -or $process.ExecutablePath -ne $CodexExe) { return $false }
    }
    $request = [Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/json/version")
    $request.Proxy = $null
    $request.Timeout = 2000
    $response = $request.GetResponse()
    try {
      $reader = [IO.StreamReader]::new($response.GetResponseStream())
      try { $version = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    } finally { $response.Dispose() }
    $uri = [Uri]$version.webSocketDebuggerUrl
    return $uri.Scheme -eq 'ws' -and $uri.Host -in @('127.0.0.1', 'localhost', '::1')
  } catch { return $false }
}

function Select-AvailablePort([int]$Preferred) {
  foreach ($candidate in $Preferred..([Math]::Min($Preferred + 100, 65535))) {
    if (@(Get-ListenerPid $candidate).Count -eq 0) { return $candidate }
  }
  Fail "No free loopback port was found between $Preferred and $($Preferred + 100)."
}

function Read-State {
  if (-not (Test-Path -LiteralPath $StatePath)) { return $null }
  Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
}

function Stop-RecordedInjector {
  $state = Read-State
  if (-not $state) { return }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($state.injectorPid)" -ErrorAction SilentlyContinue
  if (-not $process) { return }
  if ($process.ExecutablePath -ne $state.nodePath -or $process.CommandLine -notlike "*$($state.injectorPath)*--watch*") {
    Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    Write-Warning "Saved injector PID $($state.injectorPid) was reused by another process. The stale SkinKit state was cleared without stopping that process."
    return
  }
  Stop-Process -Id $state.injectorPid
}
