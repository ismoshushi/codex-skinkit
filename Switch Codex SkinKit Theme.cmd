@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\switch-theme-windows.ps1"
if errorlevel 1 pause
