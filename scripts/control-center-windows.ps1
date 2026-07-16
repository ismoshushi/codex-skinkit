param([int]$Port = 9341)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = [Windows.Forms.Form]::new()
$form.Text = 'Codex SkinKit'
$form.StartPosition = 'CenterScreen'
$form.ClientSize = [Drawing.Size]::new(420, 390)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$title = [Windows.Forms.Label]::new()
$title.Text = 'Codex SkinKit Control Center'
$title.Font = [Drawing.Font]::new('Segoe UI', 16, [Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = [Drawing.Point]::new(28, 22)

$subtitle = [Windows.Forms.Label]::new()
$subtitle.Text = 'Install, launch, customize, verify, or restore from one place.'
$subtitle.Font = [Drawing.Font]::new('Segoe UI', 9)
$subtitle.ForeColor = [Drawing.Color]::DimGray
$subtitle.AutoSize = $true
$subtitle.Location = [Drawing.Point]::new(31, 58)

function Add-ActionButton([string]$Text, [string]$Action, [int]$X, [int]$Y) {
  $button = [Windows.Forms.Button]::new()
  $button.Text = $Text
  $button.Font = [Drawing.Font]::new('Segoe UI', 10)
  $button.Size = [Drawing.Size]::new(170, 58)
  $button.Location = [Drawing.Point]::new($X, $Y)
  $button.Add_Click({
    $form.Tag = $Action
    $form.Close()
  }.GetNewClosure())
  $form.Controls.Add($button)
}

$form.Controls.AddRange(@($title, $subtitle))
Add-ActionButton 'Install / Update' 'install' 28 94
Add-ActionButton 'Start Codex' 'start' 218 94
Add-ActionButton 'Switch Theme' 'switch' 28 168
Add-ActionButton 'Customize Theme' 'customize' 218 168
Add-ActionButton 'Verify Theme' 'verify' 28 242
Add-ActionButton 'Restore Codex' 'restore' 218 242

$close = [Windows.Forms.Button]::new()
$close.Text = 'Close'
$close.Size = [Drawing.Size]::new(90, 32)
$close.Location = [Drawing.Point]::new(302, 330)
$close.Add_Click({ $form.Close() })
$form.Controls.Add($close)

[void]$form.ShowDialog()
$SelectedAction = [string]$form.Tag
if (-not $SelectedAction) { exit 0 }

switch ($SelectedAction) {
  'install' {
    & (Join-Path $PSScriptRoot 'install-dream-skin-windows.ps1') -Port $Port
  }
  'start' {
    & (Join-Path $PSScriptRoot 'start-dream-skin-windows.ps1') -Port $Port -PromptRestart
  }
  'switch' {
    & (Join-Path $PSScriptRoot 'switch-theme-windows.ps1')
  }
  'customize' {
    & (Join-Path $PSScriptRoot 'customize-theme-windows.ps1')
  }
  'verify' {
    $screenshot = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Codex SkinKit Verification.png'
    & (Join-Path $PSScriptRoot 'verify-dream-skin-windows.ps1') -Screenshot $screenshot
  }
  'restore' {
    & (Join-Path $PSScriptRoot 'restore-dream-skin-windows.ps1') -RestoreBaseTheme -RestartCodex
  }
}
exit $LASTEXITCODE
