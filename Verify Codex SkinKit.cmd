@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\verify-dream-skin-windows.ps1" -Screenshot "%USERPROFILE%\Desktop\Codex SkinKit Verification.png"
if errorlevel 1 pause
