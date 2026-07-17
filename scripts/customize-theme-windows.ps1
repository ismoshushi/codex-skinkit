param([string]$Image, [string]$Name, [string]$Tagline='Turn your favorite image into an interactive Codex workspace.', [string]$Quote='MAKE SOMETHING WONDERFUL', [string]$Accent='#7cff46', [string]$Secondary='#36d7e8', [string]$Highlight='#642a8c', [switch]$NoApply, [switch]$ResetDemo)
. (Join-Path $PSScriptRoot 'common-windows.ps1')
Discover-Codex; Require-WindowsRuntime; Ensure-StateRoot
$state = Read-State
$activePort = if ($state -and $state.port) { [int]$state.port } else { 9341 }
if ($ResetDemo) { & $Node (Join-Path $ScriptDir 'write-theme.mjs') reset-demo --output-dir $ThemeDir }
else {
  if (-not $Image) {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = [System.Windows.Forms.OpenFileDialog]::new(); $dialog.Filter = 'Images (*.png;*.jpg;*.jpeg)|*.png;*.jpg;*.jpeg'
    if ($dialog.ShowDialog() -ne 'OK') { Fail 'Image selection was cancelled.' }; $Image = $dialog.FileName
  }
  $file = Get-Item -LiteralPath $Image
  if ($file.Length -gt 16MB) { Fail 'The image is larger than 16 MB. Resize or compress it first.' }
  if ($file.Extension -notmatch '^\.(png|jpe?g)$') { Fail 'Windows customization supports PNG and JPEG images.' }
  if (-not $Name) { $Name = [IO.Path]::GetFileNameWithoutExtension($file.Name) }
  New-Item -ItemType Directory -Path $ThemeDir -Force | Out-Null
  $imageName = "background-$(Get-Date -Format yyyyMMdd-HHmmss)-$PID$($file.Extension.ToLowerInvariant())"
  Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $ThemeDir $imageName) -Force
  & $Node (Join-Path $ScriptDir 'write-theme.mjs') custom --output-dir $ThemeDir --image $imageName --name $Name --tagline $Tagline --quote $Quote --accent $Accent --secondary $Secondary --highlight $Highlight
  Get-ChildItem -LiteralPath $ThemeDir -File -Filter 'background-*' | Where-Object Name -ne $imageName | Remove-Item -Force
}
if ($LASTEXITCODE -ne 0) { Fail 'Theme customization failed.' }
if (-not $NoApply) { & (Join-Path $ScriptDir 'start-dream-skin-windows.ps1') -Port $activePort -PromptRestart }
