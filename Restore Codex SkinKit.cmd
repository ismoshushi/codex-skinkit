@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restore-dream-skin-windows.ps1" -RestoreBaseTheme -RestartCodex
if errorlevel 1 pause
