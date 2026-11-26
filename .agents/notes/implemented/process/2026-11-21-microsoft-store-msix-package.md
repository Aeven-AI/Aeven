# Agent Note: Windows releases also build a Microsoft Store package

Status: implemented

English | [中文](2026-11-21-microsoft-store-msix-package.zh.md)

## Problem

Windows releases ship only an NSIS installer, and none of the Azure Trusted Signing secrets the release workflow reads are set, so every Windows installer is published unsigned and SmartScreen warns before it runs. The NiftyLabs developer account passed Microsoft Store vetting on 2026-11-20, and Partner Center reserved the "Æven" product (Store ID `9P7Q0BFG2Z9B`). The Store signs every MSIX package it distributes, so a Store package is the one Windows distribution that needs no certificate of our own. The reservation lapses unless a package is submitted within three months.

## Decision

Each Windows package command runs a second electron-builder pass after the installer: `--win appx --prepackaged <win-unpacked>` with `AVN_DESKTOP_STORE_PACKAGE=1`. The pass packs the application the installer already carries into `aeven-<version>-win-<arch>-store.appx` and does not package the application again. In that mode `scripts/electron-builder-config.mjs` selects the `appx` target, drops Trusted Signing, and reads its manifest template and tiles from `installer/appx/`. The package itself stays unsigned. A Trusted Signing certificate cannot sign it, because signtool refuses a certificate whose subject differs from the manifest's Store-assigned publisher.

`MICROSOFT_STORE_IDENTITY` holds the values Partner Center assigned: identity name `AevenAI.ven` (Partner Center dropped the Æ), publisher `CN=361943AA-1813-410C-890C-540D8C89681E`, publisher display name `AevenAI`, and display name `Æven`. The Store rejects a package whose identity or display name differs. The manifest Description is the product synopsis the Linux packages already show, not the package.json description written for maintainers.

The manifest template declares the `unvirtualizedResources` restricted capability and excludes the app's own `%APPDATA%\Aeven` folder and its `io.aeven.browser` native-messaging key under each Chromium browser from write virtualization; Windows virtualizes every other write to AppData and `HKCU`. Those exclusions exist only on Windows 11, so `minVersion` is 10.0.22000.0. [The narrow write-virtualization Agent Note](2026-11-26-store-package-narrow-write-virtualization.md) records why, and why the whole-package opt-outs of the first two submissions were dropped. The package declares `location`, `microphone` and `webcam`, because Windows privacy settings grant device access to a packaged app by its declared capabilities.

When `process.windowsStore` is true, the app skips two steps. `UpdateCoordinator` reports no updater configuration, because the Store replaces the package and electron-updater would download and run an NSIS installer. `setAsDefaultProtocolClient` is not called, because the manifest declares `aeven://` and the install folder changes with every Store update. The native-messaging launcher still names `process.execPath`, which is correct because it is rewritten on every launch.

The release workflow uploads each `.appx` as the `store-win-<arch>` workflow artifact, not as a release asset: Windows installs no unsigned package outside the Store. Both architectures go into one Partner Center submission.

## Alternatives considered

**Add `appx` to the installer's target list.** That would package once, but a signed release would then sign the `.appx` with the Trusted Signing certificate, and signtool fails on the publisher mismatch.

**Publish the `.appx` on the GitHub Release.** Readers would download a package Windows refuses to install.

## Consequences

- The Store pass adds one makeappx run to each Windows target. makeappx and makepri come from electron-builder's Windows kit bundle and run only on Windows, so the package is built on the release runners, never on macOS.
- `unvirtualizedResources` is a restricted capability, so the Partner Center submission must justify each excluded folder and key, state that the app writes nothing else in the registry, and say how the keys are removed and what an uninstall leaves.
- Windows runs no application code when a Store package is uninstalled and keeps unvirtualized data. The four registry keys, `%APPDATA%\Aeven`, the Aeven home, and files the agent wrote outside AppData stay unless the reader turned the extension off first or deletes them.
- A Store install and an NSIS install on one machine share one profile and one running instance.
- Store submission stays manual: download the two workflow artifacts and upload them to Partner Center. Automating it through the Store submission API needs a Partner Center Entra application and its credentials.
