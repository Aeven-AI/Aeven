# Agent Note: Desktop location asks the operating system itself

Status: implemented

English | [中文](2026-11-01-desktop-location-asks-the-system.zh.md)

## Problem

`get_location` timed out on a first use of the desktop application, with macOS raising no location alert at all. The evidence pointed away from our own seams: location never touches `ctx.approval`, `/var/db/locationd/clients.plist` already carried `com.aeven.desktop` with `Registered = True` and no `Authorized` key, and switching the application on by hand in **System Settings → Privacy & Security → Location Services** made the same call answer with `{source: "device", precision: "precise", accuracyMeters: 35}`.

The gap sits between Electron and Chromium. Electron answers the renderer's geolocation permission itself and, with no permission handler installed, grants it and calls `GeolocationControl::UserDidOptIntoLocationServices()`. Chromium's `GeolocationProviderImpl` then starts nothing while `GeolocationSystemPermissionManager` reports `kNotDetermined` (`OnClientsChanged` returns early) — and only `RequestSystemPermission()` produces a decision, which Chrome's browser UI calls and Electron never does. So the application registers with `locationd`, no alert is raised, no provider runs, and `getCurrentPosition` ends in a timeout that looks like a device problem.

## Decision

The shell owns the operating system's decision, and the client asks for it before it reads.

- `apps/desktop/src/system-location.ts` binds CoreLocation through koffi — already a desktop dependency, already excluded from bundling — to read `CLAuthorizationStatus` and to raise `requestWhenInUseAuthorization`, waiting up to 30 s for the alert to be answered. Windows and Linux answer for the whole machine with no per-application prompt, so the module reports `system-managed` there and offers the pane that carries the switch (`ms-settings:privacy-location`; macOS's Location Services pane).
- The decision crosses to the page through the existing preload bridge as `avnDesktop.location.authorize()` and `.openSettings()`, both behind `assertDesktopSender`.
- `@aeven/client-ui-location` reads through `readLocationWithPermission()`: the system's decision first, then `navigator.geolocation`. A refused switch renders a `denied` status whose card offers **Open settings** next to OK, so recovery is one click instead of a hunt through System Settings.

## Alternatives considered

- **Deep link to the settings pane only** — recovery without the alert leaves every first use dead, which is the reported failure.
- **Read the position through CoreLocation** — Chromium already delivers the position once TCC allows it; binding the reading as well would duplicate provider and accuracy semantics for no gain.
- **Install Electron permission handlers naming `geolocation`** — they answer the renderer's permission, which was granted all along; the system decision is a separate gate.

## Consequences

A macOS first use now shows the system alert, and the wait for its answer counts against the tool's own consent timeout rather than the read's 10 s. The alert cannot appear without `NSLocationWhenInUseUsageDescription` in the bundle, which `scripts/macos-usage-descriptions.mjs` already declares. A page served in a browser keeps the browser's prompt, reporting `system-managed` with no settings pane to offer. The desktop module's binding and the platform dispatch run on this machine; the alert itself is only observable in a rebuilt application, which is what a release carries.
