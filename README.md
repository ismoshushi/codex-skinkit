# Codex SkinKit for Windows

An unofficial theme layer for the Microsoft Store version of Codex on Windows 10/11.

It adds a customizable home banner and task background while keeping the native sidebar, cards, project selector, task content, menus, and composer interactive. The official MSIX package and `app.asar` are never modified.

## Install

1. Install and open the official Codex app once.
2. Download this repository and extract it completely.
3. Double-click `Install Codex SkinKit.cmd`.
4. Allow the one-time Codex restart.

The installer creates Desktop entries for starting, customizing, switching, verifying, and restoring the theme.

## Switch themes

Double-click `Codex SkinKit - Switch Theme.cmd`, choose a saved preset, and select Apply. The bundled presets are `Open Portal` and `Deep Space Mission Control`.

## Customize

Double-click `Codex SkinKit - Customize.cmd`, then select a PNG or JPEG image up to 16 MB.

For best results, use a wide image at least 2000 px across and keep important subjects away from the left edge.

## Verify

Run `Codex SkinKit - Verify.cmd`. A successful live check returns `pass: true` and saves a screenshot to the Desktop.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-tests-windows.ps1
```

## Restore

Double-click `Codex SkinKit - Restore.cmd` to remove the live theme, restore the saved Codex base colors, close the debugging session, and start Codex normally.

## Security

- Only the official `OpenAI.Codex` Microsoft Store package is accepted.
- The bundled Node.js signature and copied-file hash are verified.
- Chrome DevTools Protocol listens on `127.0.0.1` only.
- The injector accepts only native `app://` Codex pages.
- The official package, signature, and `app.asar` remain untouched.

CDP is a local unauthenticated debugging interface while the theme is active. Do not run untrusted local software during a themed session; use Restore when the theme is not needed.

## Requirements

- Windows 10 or Windows 11, x64
- Official Microsoft Store Codex app
- PowerShell 5.1 or newer

No global Node.js installation is required.

## License

MIT. Codex and OpenAI are trademarks of OpenAI. This project is unofficial and is not affiliated with or endorsed by OpenAI.
