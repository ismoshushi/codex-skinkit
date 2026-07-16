param([string]$Theme)
. (Join-Path $PSScriptRoot 'common-windows.ps1')
Discover-Codex; Require-WindowsRuntime; Ensure-StateRoot

$profiles = @(Get-ChildItem -LiteralPath $ProfilesRoot -Directory -ErrorAction SilentlyContinue | Where-Object {
  Test-Path -LiteralPath (Join-Path $_.FullName 'theme.json')
} | ForEach-Object {
  $config = Get-Content -LiteralPath (Join-Path $_.FullName 'theme.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  [pscustomobject]@{ Id = $_.Name; Name = $config.name; Path = $_.FullName }
})
if ($profiles.Count -lt 1) { Fail "No theme profiles were found in $ProfilesRoot" }

if (-not $Theme) {
  Add-Type -AssemblyName System.Windows.Forms
  $form = [Windows.Forms.Form]::new()
  $form.Text = 'Codex SkinKit - Switch Theme'
  $form.StartPosition = 'CenterScreen'
  $form.ClientSize = [Drawing.Size]::new(420, 250)
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $label = [Windows.Forms.Label]::new(); $label.Text = 'Choose a theme'; $label.AutoSize = $true; $label.Location = [Drawing.Point]::new(20, 18)
  $list = [Windows.Forms.ListBox]::new(); $list.Location = [Drawing.Point]::new(20, 48); $list.Size = [Drawing.Size]::new(380, 130); $list.DisplayMember = 'Name'
  [void]$list.Items.AddRange($profiles)
  if ($list.Items.Count -gt 0) { $list.SelectedIndex = 0 }
  $apply = [Windows.Forms.Button]::new(); $apply.Text = 'Apply'; $apply.Location = [Drawing.Point]::new(310, 195); $apply.DialogResult = 'OK'
  $cancel = [Windows.Forms.Button]::new(); $cancel.Text = 'Cancel'; $cancel.Location = [Drawing.Point]::new(220, 195); $cancel.DialogResult = 'Cancel'
  $form.Controls.AddRange(@($label, $list, $apply, $cancel)); $form.AcceptButton = $apply; $form.CancelButton = $cancel
  if ($form.ShowDialog() -ne 'OK' -or -not $list.SelectedItem) { exit 0 }
  $selected = $list.SelectedItem
} else {
  $selected = $profiles | Where-Object { $_.Id -eq $Theme -or $_.Name -eq $Theme } | Select-Object -First 1
  if (-not $selected) { Fail "Unknown theme profile: $Theme" }
}

$temporary = "$ThemeDir.switching.$PID"
Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $temporary -Force | Out-Null
Copy-Item -Path (Join-Path $selected.Path '*') -Destination $temporary -Recurse -Force
Remove-Item -LiteralPath (Join-Path $temporary 'SOURCE.md') -Force -ErrorAction SilentlyContinue
& $Node $Injector --check-payload --theme-dir $temporary | Out-Null
if ($LASTEXITCODE -ne 0) { Remove-Item -LiteralPath $temporary -Recurse -Force; Fail "Theme profile validation failed: $($selected.Name)" }
Remove-Item -LiteralPath $ThemeDir -Recurse -Force -ErrorAction SilentlyContinue
Move-Item -LiteralPath $temporary -Destination $ThemeDir
& (Join-Path $ScriptDir 'start-dream-skin-windows.ps1') -Port 9341 -PromptRestart
Write-Host "Applied theme: $($selected.Name)"
