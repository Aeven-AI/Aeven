# Agent Note: Window drag from the first painted frame

Status: implemented

English | [中文](2026-10-17-window-drag-from-first-paint.zh.md)

## Problem

The desktop window draws no title bar (`titleBarStyle: 'hiddenInset'` on macOS, `hidden` with a title overlay on Windows, `frame: false` on Linux), so it moves only where the page declares `-webkit-app-region: drag`. On macOS that rectangle belonged to `AppFrame`'s pseudo-element in `@aeven/client-ui-layout`, which exists only once React mounts, and neither the start screen nor the client's first-paint shell declared one. A launch was undraggable from window creation until the first client render, which is the whole splash ([issue 138](https://github.com/Aeven-AI/Aeven/issues/138)).

## Decision

**Partly superseded by [The window drag band is an element](2026-10-17-window-drag-band-element.md).** The rectangle is now an element in each document that draws it, because Chromium reads `-webkit-app-region` from elements only, so the pseudo-element rules this note decided never dragged the window.

The shell owns the band, and both documents that can hold the window draw it themselves:

- `startPageDocument()` draws it for macOS, above its own cover, so the start screen is draggable on its first painted frame.
- `apps/web/src/preloader.css`, the first-paint sheet inlined into the document head, draws the same band gated on `html[data-avn-traffic-lights]`, so every client screen has it before React renders and after any remount. Its height is the client header row (`8px + var(--dsw-aeven-control-size, 40px)`), with the product's own 40 px as the fallback because no theme stylesheet has loaded when it first paints. Its `z-index: 2001` clears the shell's own preloader (2000), which covers the frame while the client boots.

`AppFrame` no longer draws the band; it keeps the `no-drag` holes that subtract controls from it, since the band is applied by the window rather than by hit testing. The preload now marks the document with its platform's window chrome as soon as the parser creates the document element, and installs the Windows and Linux caption strip at that moment too: a preload runs before the element exists, so `DOMContentLoaded` left exactly the same gap on every platform. The strip's own decision stays as the [Linux desktop caption strip](../architecture/2026-10-14-linux-desktop-caption-strip.md) records it; only the moment it is installed moved.

## Alternatives considered

**Keep the band on `AppFrame` and add a second copy to the first-paint shell.** Two owners of one rectangle drift apart — the component's height follows the loaded theme, the shell's fallback does not — and a remount can only ever drop one of them.

**Inject the band from the preload at document start.** The preload runs before the document element exists, so an injected style needs the same wait-for-the-parser machinery while the rule belongs in a document the shell already serves. The gate attribute stays in the preload because only the carrier knows the platform.

## Consequences

The macOS band is a document-level rule, so it sits above the client's modals (z-index 1000) for drag hit-testing where the component rule sat below them (z-index 60). It takes no pointer events, so clicks reach the controls in the band; a drag begun in the header row over an open modal now moves the window, as the native title bar would. The start screen and the client use the same height, gate, and clearance, so the handover moves nothing.

## Verification

`apps/desktop/tests/start-screen.spec.ts` asserts that the macOS document carries the band and that the Windows and Linux documents do not. The `apps/web/tests/preloader-shell.spec.ts` this note added was deleted with the pseudo-element rule it guarded; [the band element note](2026-10-17-window-drag-band-element.md) owns its replacement. The band itself was not exercised in a running window here, which needs a macOS launch of the development or packaged shell.
