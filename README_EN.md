<div align="center">

# Codex SkinKit

An unofficial theme toolkit for Codex on Windows. Install, switch, and customize backgrounds while keeping the native interface fully interactive.

[简体中文](./README.md) · [Quick start](#quick-start) · [Bundled themes](#bundled-themes) · [Security](#security) · [Sponsor and contact](#sponsor-and-contact)

</div>

## What is Codex SkinKit?

Codex SkinKit adds a customizable home banner and task background to the Microsoft Store version of Codex. The native sidebar, cards, project selector, task content, menus, and composer remain interactive.

It never modifies the official MSIX package or `app.asar`. The theme is injected through a local Chrome DevTools Protocol session bound to `127.0.0.1`, and the Restore command returns Codex to its original appearance.

## Preview

<table>
  <tr>
    <th width="33.33%">World Cup Night</th>
    <th width="33.33%">Deep Space Mission Control</th>
    <th width="33.33%">Ember Bloom</th>
  </tr>
  <tr>
    <td><a href="./assets/readme/world-cup-night-preview.png"><img src="./assets/readme/world-cup-night-preview.png" alt="World Cup Night theme running in Codex" width="100%" /></a></td>
    <td><a href="./assets/readme/deep-space-preview.png"><img src="./assets/readme/deep-space-preview.png" alt="Deep Space Mission Control theme running in Codex" width="100%" /></a></td>
    <td><a href="./assets/readme/ember-bloom-preview.png"><img src="./assets/readme/ember-bloom-preview.png" alt="Ember Bloom theme running in Codex" width="100%" /></a></td>
  </tr>
  <tr>
    <th>Aurora Veil</th>
    <th></th>
    <th></th>
  </tr>
  <tr>
    <td><a href="./assets/readme/aurora-veil-preview.png"><img src="./assets/readme/aurora-veil-preview.png" alt="Aurora Veil theme running in Codex" width="100%" /></a></td>
    <td></td>
    <td></td>
  </tr>
</table>

## Features

- Double-click installation, launch, verification, and restoration
- Quick switching among five bundled themes
- Custom themes made from your own PNG or JPEG image
- Automatic backup and restoration of the original Codex base colors
- Validation of the Codex package, Node.js signature, and copied-file hashes
- No global Node.js installation required

## Requirements

- Windows 10 or Windows 11 (x64)
- The official Codex app installed from Microsoft Store
- PowerShell 5.1 or newer

> The current release is Windows-only and does not support Codex installed from other sources.

## Quick start

1. Install and open the official Codex app at least once, then close it.
2. Download this repository and extract it completely to a regular folder.
3. Double-click `Codex SkinKit.cmd` and choose **Install / Update**.
4. Allow the prompted Codex restart.

The installer creates only one Desktop entry, `Codex SkinKit.cmd`. Open it to access the control center:

| Control center action | Purpose |
| --- | --- |
| Install / Update | Install or update SkinKit |
| Start Codex | Start Codex with the current theme |
| Switch Theme | Switch between bundled themes |
| Customize Theme | Create a theme from your own image |
| Verify Theme | Check the live theme and save a screenshot |
| Restore Codex | Remove the theme and restore the original appearance |

## Bundled themes

| Open Portal | Deep Space Mission Control | World Cup Night |
| --- | --- | --- |
| ![Open Portal](./profiles/open-portal/open-portal.png) | ![Deep Space Mission Control](./profiles/deep-space/earth-airglow.jpg) | ![World Cup Night](./profiles/world-cup/world-cup-night.png) |

| Aurora Veil | Ember Bloom |
| --- | --- |
| ![Aurora Veil](./profiles/aurora-veil/art.png) | ![Ember Bloom](./profiles/ember-bloom/art.png) |

Aurora Veil and Ember Bloom are adapted from the MIT-licensed original demo themes in [Finderchangchang/codex-autoskin](https://github.com/Finderchangchang/codex-autoskin) and converted to the SkinKit theme schema.

Open `Codex SkinKit.cmd`, choose **Switch Theme**, select a theme, and choose **Apply**. Codex restarts when needed.

## Customize a theme

Open the control center, choose **Customize Theme**, and select a PNG, JPG, or JPEG image up to 16 MB.

For best results, use a wide image at least 2000 px across and keep important subjects away from the left edge, where interface content may cover them.

For additional control over the theme name, copy, and colors, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\customize-theme-windows.ps1 `
  -Image "C:\path\to\background.jpg" `
  -Name "My Theme" `
  -Accent "#7cff46"
```

## Verify and test

Open the control center and choose **Verify Theme**. A successful check returns `pass: true` and saves `Codex SkinKit Verification.png` to the Desktop.

Developers can also run:

```powershell
npm test
```

or:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\run-tests-windows.ps1
```

## Restore Codex

Open the control center and choose **Restore Codex**. It removes the live theme, restores the saved Codex base colors, closes the local debugging session, and starts Codex normally.

## Security

- Only the official `OpenAI.Codex` Microsoft Store package is accepted.
- The official package, signature, and `app.asar` are never modified.
- Chrome DevTools Protocol listens on `127.0.0.1` only.
- The injector accepts only native Codex `app://` pages.
- The bundled Node.js signature and copied-file hashes are verified.

While the theme is active, CDP is an unauthenticated debugging interface available to local software. Do not run untrusted local programs at the same time. Use Restore to close the debugging session when the theme is not needed.

## Troubleshooting

### The installer cannot find the Codex configuration

Open the official Codex app normally, wait for its home screen to load, close it, and run the installer again.

### A custom image is rejected

Make sure the image is PNG, JPG, or JPEG and no larger than 16 MB.

### I want to disable the theme completely

Open `Codex SkinKit.cmd` from the Desktop and choose **Restore Codex**. You can reinstall later with **Install / Update**.

## Sponsor and contact

If Codex SkinKit saves you time, you can support ongoing maintenance through the WeChat reward code. For product partnerships, sponsorships, bug reports, or Codex-related discussion, scan the contact code and include a short note describing your request.

| WeChat contact | WeChat support |
| --- | --- |
| <img src="./assets/readme/wechat-contact.png" alt="WeChat contact QR code" width="220" /> | <img src="./assets/readme/wechat-reward.jpg" alt="WeChat reward QR code" width="220" /> |

> These contact and support methods are shared with the [Learn Codex](https://github.com/ismoshushi/learn-codex) project.

## Contributing

Issues and pull requests are welcome. Please include your Windows version, Codex version, reproduction steps, and verification results. Screenshots are especially useful for interface problems.

## Acknowledgements

Thanks to [Finderchangchang/codex-autoskin](https://github.com/Finderchangchang/codex-autoskin) and its author, Vikicc, for the procedurally generated original theme artwork and the detailed theme design approach. The `Aurora Veil` and `Ember Bloom` themes in this project were adapted to the Codex SkinKit format under its MIT license.

## Disclaimer and license

This project is licensed under the [MIT License](./LICENSE). Codex and OpenAI are trademarks of OpenAI.

Codex SkinKit is an unofficial community project. It is not affiliated with or endorsed by OpenAI. Images supplied by users remain the property of their respective owners; the MIT License does not grant rights to those images or related trademarks.
