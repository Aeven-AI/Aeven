# Agent Note: Desktop start screen

Status: implemented

English | [中文](2026-10-16-desktop-start-screen.zh.md)

## Problem

A launch of Aeven showed nothing until its backend was ready. The shell created its window only after reading the packaged deployment, querying the login shell for [PATH](../bug-fix/2026-10-15-desktop-host-uses-login-shell-path.md), choosing a backend, installing or reconciling the release, and starting a Host, and a window it created then stayed hidden until its first paint. Measured on the installed 0.3.4-alpha macOS build: the window appeared 5.7 s after the process started on an ordinary launch, and 24.5 s on a launch that installed a release, where the install, about 19 s of it including the staged health-check boot, ran before any window existed. Nothing on screen distinguished those seconds from a launch that never paints: the Dock bounce ends with Electron's ready event, and a second launch did nothing at all, because the shell installs the focus handler a later launch reaches only after the backend is ready.

## Decision

`main` creates the main window and loads the start screen into it before its first wait. The screen is served from the shell's own scheme at `avn-app://shell/start.html` by the protocol handler registered above it, so it needs no Host and no package state; `start-screen.ts` generates the document and `brand-page.ts` owns the face it draws. Once the backend answers, the same window loads the application's own address and the client's preloader continues from there. A second launch during the boot focuses the start screen, because the window and the focus handler both exist before the first wait.

The screen is the loading face alone. `brand-page.ts` draws the Æven mark at 50 px with the loading mark 4 px under it, turning once every 900 ms, on the colours the client's preloader paints next — `rgb(242,242,242)` with black ink in the light scheme, `#111111` with `rgb(249,250,251)` in the dark one, following the system scheme, and honouring `prefers-reduced-motion` — which is the face the [static Web shell preloader](../bug-fix/2026-09-02-static-web-shell-preloader.md) owns. It carries no copy, so the handover to that preloader moves nothing. The sign-in pages in `oauth-browser.ts` draw the same face from the same module, which keeps the two from drifting; its label names the flow only where a screen has nothing else to read.

## Alternatives considered

**A separate frameless splash window.** This is the common Electron arrangement, and it can be dismissed on its own. It costs a second window to place, focus, and hand over on three platforms, where the shell's own window already carries each platform's title bar and its [caption strip](../architecture/2026-10-14-linux-desktop-caption-strip.md) and caption menu, and where the start screen would have to duplicate the window's own sizing and chrome rules.

**Text on the screen naming the phase.** "Getting Aeven ready", "Installing packages", and "Starting services" told the reader what a long wait was for, at the cost of the shell's locale plus an IPC path from `main` to the page carrying each phase and its answer to a page that asks late. The first implementation shipped that way; the reserved line under the spinner held the mark about 19 px above the client preloader's centre, and the jump back was visible at the handover, so the copy and the whole phase path were removed. The measured wait it explained, 19 s of install, is left to the face.

**Booting the client before the backend and letting it retry.** Serving the built frontend from the shell would let the client's own preloader start at the same moment as this screen and shorten the visible wait from about 5.7 s to about 1 s, since the Host boot is the wait. It makes the client boot without a Host and without a decided origin, which reaches the connection and trust path rather than the shell's first frame, and it stays available as its own change.

## Consequences

A launch paints the product's own face within a few hundred milliseconds of the process starting, whatever waits behind it: the deployment read, the login-shell query, a release install, and the Host boot. What the reader sees during a long wait is now the product rather than an absence, and a second launch during the boot brings that window forward instead of being discarded.

The start screen is in the boot path, so a page that cannot load falls back to the shell's earlier behaviour: `loadURL` logs and the sequence continues, and the application opens when the backend is ready. The screen is replaced rather than dismissed, so no window is created or closed to show it.

Verification: unit tests cover the generated document and the face it shares with the sign-in pages (`apps/desktop/tests/start-screen.spec.ts`, `apps/desktop/tests/oauth-browser.spec.ts`). A development shell launched against a throwaway home with its own user data, whose renderer debug endpoint reported each page as it loaded, showed `avn-app://shell/start.html` 0.3 s after the process started and the application's own origin at 8.4 s, the Host boot of that profile; the window showed the face throughout.
