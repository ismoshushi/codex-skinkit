@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\control-center-windows.ps1"
if errorlevel 1 pause
