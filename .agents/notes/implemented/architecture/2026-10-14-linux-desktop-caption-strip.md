# Agent Note: Linux desktop draws its own caption strip

Status: implemented

English | [中文](2026-10-14-linux-desktop-caption-strip.zh.md)

## Problem

On Linux the desktop shell kept the standard GTK frame. GNOME's native menu bar and its theme's round caption buttons sat above the page in the GTK theme's colours, which the page cannot set: Electron exposes no menu bar colour, and on Linux `titleBarOverlay` paints the theme's own buttons whatever overlay `color` and `symbolColor` it receives.

## Decision

- **Linux windows are frameless and reuse the Windows caption strip.** `createWindow` in `apps/desktop/src/main.ts` passes `frame: false` on Linux. The preload (`apps/desktop/src/preload-app.ts`) installs the same 32 px strip and page-drawn menu bar it installs on Windows, and on Linux adds minimize, maximize and close buttons in a shadow root at the strip's right end.
- **The buttons act through one IPC channel.** Each button sends `avn-desktop:caption-window-control` with a `DesktopCaptionAction`; the main process accepts it only on Linux and only from the main window's main frame, and `maximize` toggles. Their accessible names and tooltips come from the shell locale (`minimizeWindow`, `maximizeWindow`, `closeWindow`) over `avn-desktop:caption-button-labels`.
- **The strip is `#f2f2f2` in the light scheme.** The scheme reporter writes `data-avn-caption-scheme` on the root element and the strip's style paints `#f2f2f2` under it on Windows and Linux; the dark scheme keeps the body background, and the button glyphs follow the scheme. Windows keeps its native caption buttons over a transparent overlay.

## Alternatives considered

**Auto-hide the native menu bar.** One `autoHideMenuBar` line removes the white bar, but GNOME's title bar and buttons still sit above the page in theme colours, so the strip could not match the page.

**`titleBarOverlay` on Linux, as on Windows.** It hides the frame and menu bar, but Electron draws the GTK theme's caption buttons, which on Yaru are grey circles regardless of the overlay colours.

## Consequences

- Linux loses window-manager decorations: the page-drawn strip owns dragging (`-webkit-app-region: drag`) and the three window actions, and any window-manager behaviour beyond those, such as edge resizing, depends on Electron's frameless-window support on the session's compositor.
- Linux and Windows share one strip and menu bar; Linux additionally carries three buttons, two IPC channels, and three locale keys.
- The light strip is a fixed `#f2f2f2` rather than the body background, so a light theme that changes the page background leaves the strip at that value.
