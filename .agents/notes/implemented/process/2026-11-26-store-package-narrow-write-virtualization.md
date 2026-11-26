# Agent Note: The Store package excludes only its own folder and keys from write virtualization

Status: implemented

English | [中文](2026-11-26-store-package-narrow-write-virtualization.zh.md)

## Problem

The [Microsoft Store package](2026-11-21-microsoft-store-msix-package.md) declares the `unvirtualizedResources` restricted capability. Microsoft refused the first submission under policy 10.6.3 because the manifest turned off file-system and registry write virtualization for the whole package. The certification report of 2026-11-26 asked which folders and keys need to stay unvirtualized, and for confirmation that every other write stays virtualized. The second submission narrowed the registry to four keys on Windows 11, but it kept `desktop6:FileSystemWriteVirtualization` disabled for the whole package, and on Windows 10 it kept `desktop6:RegistryWriteVirtualization` disabled for the whole package. Both contradict what the report asked for.

## Decision

`installer/appx/AppxManifest.xml` has no `desktop6` virtualization property. It excludes one folder and four keys from write virtualization, and Windows virtualizes every other write to AppData and `HKCU`:

- `virtualization:ExcludedDirectory` `$(KnownFolder:RoamingAppData)\Aeven`, Electron's user-data directory (`productName` `Aeven`). A Store install and an NSIS install on one machine therefore share one profile and one single-instance lock.
- `virtualization:ExcludedKey` `HKCU\Software\<browser>\NativeMessagingHosts\io.aeven.browser` for Chrome, Chromium, Brave and Edge. These are the keys `windowsHostKeys()` returns. A browser never reads a virtualized copy of them.

The browser host's launcher and manifest live in `$AVN_HOME/runtime`, and the Aeven home is `%USERPROFILE%\.aeven`. That is outside AppData, so file-system virtualization never applies to it. Elsewhere in AppData the app and its Host only read: browser profiles, the Git and Android SDK locations, and Chromium installs.

Windows 11 is the first release with directory and key exclusions. Windows 10 offers only the whole-package `desktop6` properties, so `minVersion` is 10.0.22000.0. `tests/store-manifest.spec.ts` holds the excluded keys to `windowsHostKeys()`, the excluded folders to the user-data directory alone, and the manifest to no `desktop6` property.

## Alternatives considered

**Keep file-system writes unvirtualized for the whole package.** The agent's tools could then write anywhere under AppData, for example an `npm install -g`, a `pip install --user` or another program's settings file, and other programs would read the result. The certification report treats a whole-package opt-out as the thing to justify away, and the folders a task touches are not known in advance, so no list can name them.

**Exclude all of `%APPDATA%` or `%LOCALAPPDATA%`.** Other programs would then read what the agent's tools write there, but it is a whole-package opt-out by another name and invites the same refusal.

**Keep Windows 10 with the `desktop6` registry opt-out.** Windows 10 readers would keep the Store package, but the package would still turn off registry virtualization for the whole app there. Windows 10 readers keep the NSIS installer.

**Ship Windows 10 with registry virtualization on and the browser extension unavailable.** This keeps the Store package on Windows 10, but the app would need to detect that case and refuse the extension. Every Windows 10 Store install would lack a feature, and the Windows 10 Store audience is not worth that extra mode.

## Consequences

- In the Store build, what the agent's tools write under AppData lands in the package's private store. The agent's own later commands see it, other programs do not, and uninstalling the package removes it. The NSIS build has no such redirection.
- The Store package does not install on Windows 10; Windows 10 readers use the NSIS installer.
- The submission justifies one folder and four keys, each owned by the app, and can confirm that every other write stays virtualized.
- Uninstalling the package leaves `%APPDATA%\Aeven`, the four keys unless Browser extension was turned off first, and the Aeven home.
