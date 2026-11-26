# Agent Note: Windows releases also build a Microsoft Store package

Status: implemented

English | [中文](2026-11-21-microsoft-store-msix-package.zh.md)

## Problem

Windows releases ship only an NSIS installer, and none of the Azure Trusted Signing secrets the release workflow reads are set, so every Windows installer is published unsigned and SmartScreen warns before it runs. The NiftyLabs developer account passed Microsoft Store vetting on 2026-11-20, and Partner Center reserved the "Æven" product (Store ID `9P7Q0BFG2Z9B`). The Store signs every MSIX package it distributes, so a Store package is the one Windows distribution that needs no certificate of our own. The reservation lapses unless a package is submitted within three months.

## Decision

Each Windows package command runs a second electron-builder pass after the installer: `--win appx --prepackaged <win-unpacked>` with `AVN_DESKTOP_STORE_PACKAGE=1`. The pass packs the application the installer already carries into `aeven-<version>-win-<arch>-store.appx` and does not package the application again. In that mode `scripts/electron-builder-config.mjs` selects the `appx` target, drops Trusted Signing, and reads its manifest template and tiles from `installer/appx/`. The package itself stays unsigned. A Trusted Signing certificate cannot sign it, because signtool refuses a certificate whose subject differs from the manifest's Store-assigned publisher.

`MICROSOFT_STORE_IDENTITY` holds the values Partner Center assigned: identity name `AevenAI.ven` (Partner Center dropped the Æ), publisher `CN=361943AA-1813-410C-890C-540D8C89681E`, publisher display name `AevenAI`, and display name `Æven`. The Store rejects a package whose identity or display name differs. The manifest Description is the product synopsis the Linux packages already show, not the package.json description written for maintainers.

The manifest template declares the `unvirtualizedResources` restricted capability for two kinds of write. `desktop6:FileSystemWriteVirtualization` is `disabled`. Without it, Windows redirects every write under `%APPDATA%`, by the app and by the tools its agent runs, into a per-package store, where no other program reads an `npm install -g`, a `pip install --user`, or an edited settings file. Those folders depend on the reader's task, so no `virtualization:ExcludedDirectories` list covers them. An NSIS install and a Store install would also hold different Electron single-instance locks while sharing the Aeven home folder, so two backends could serve one profile. For the registry, `virtualization:ExcludedKeys` names the app's own key under each Chromium browser, `HKCU\Software\<browser>\NativeMessagingHosts\io.aeven.browser`, because a browser never reads a virtualized copy of the host key that `browser-extension.ts` writes with `reg add`. Windows 11 honours that list and virtualizes every other registry write. Windows 10 has no key exclusions: `IgnorableNamespaces` makes it skip the element, and `desktop6:RegistryWriteVirtualization` set to `disabled` leaves every registry write unvirtualized there. Excluding that key alone is enough: on Windows 11 build 26300 a write to it from inside the package reached the real hive even where the browser's `NativeMessagingHosts` key did not exist yet, a sibling key beside it stayed virtualized, and Chrome started the packaged host. The app writes only the four keys `windowsHostKeys()` returns. `ExtensionIntegration` deletes them with the host manifest and launcher when the reader turns Browser extension off in Settings, and the NSIS uninstaller deletes the keys; `tests/store-manifest.spec.ts` holds the manifest's exclusions and the uninstaller's deletions to that list. Microsoft denied the first submission, which turned both kinds of virtualization off for the whole app on a one-sentence justification (certification report of 2026-11-26, policy 10.6.3). `minVersion` is 10.0.18362.0, the first release that honours these properties. The package declares `location`, `microphone` and `webcam`, because Windows privacy settings grant device access to a packaged app by its declared capabilities.

When `process.windowsStore` is true, the app skips two steps. `UpdateCoordinator` reports no updater configuration, because the Store replaces the package and electron-updater would download and run an NSIS installer. `setAsDefaultProtocolClient` is not called, because the manifest declares `aeven://` and the install folder changes with every Store update. The native-messaging launcher still names `process.execPath`, which is correct because it is rewritten on every launch.

The release workflow uploads each `.appx` as the `store-win-<arch>` workflow artifact, not as a release asset: Windows installs no unsigned package outside the Store. Both architectures go into one Partner Center submission.

## Alternatives considered

**Add `appx` to the installer's target list.** That would package once, but a signed release would then sign the `.appx` with the Trusted Signing certificate, and signtool fails on the publisher mismatch.

**Keep write virtualization.** This needs no restricted capability, but it breaks the browser extension's native-messaging registration, hides what the agent's tools write under AppData from every other program, and splits the single-instance lock between Store and NSIS installs that share one Aeven home.

**Require Windows 11 for the Store package.** Every Store install would then get the exact key exclusions, but Windows 10 readers would lose the Store package, and the certification report accepts an explanation where exact exclusions cannot work.

**Publish the `.appx` on the GitHub Release.** Readers would download a package Windows refuses to install.

## Consequences

- The Store pass adds one makeappx run to each Windows target. makeappx and makepri come from electron-builder's Windows kit bundle and run only on Windows, so the package is built on the release runners, never on macOS.
- `unvirtualizedResources` is a restricted capability, so the Partner Center submission must justify it point by point: why no directory list fits, the four registry keys, that the app writes nothing else in the registry, how the keys are removed, and what an uninstall leaves.
- Windows runs no application code when a Store package is uninstalled and keeps unvirtualized data. The four registry keys, the Aeven home, and files the agent wrote stay unless the reader turned the extension off first or deletes them.
- A Store install and an NSIS install on one machine share one profile and one running instance.
- Store submission stays manual: download the two workflow artifacts and upload them to Partner Center. Automating it through the Store submission API needs a Partner Center Entra application and its credentials.
