# Agent Note: The window drag band is an element

Status: implemented

English | [中文](2026-10-17-window-drag-band-element.zh.md)

## Problem

A desktop window moves only where the page declares `-webkit-app-region: drag`. [Window drag from the first painted frame](2026-10-17-window-drag-from-first-paint.md) put that rectangle in two stylesheets as a `body::before` rule, so it would exist before React mounted. Chromium reads draggable regions from elements and ignores the property on pseudo-elements, so neither rule ever became one: the window stayed undraggable in the start screen and in the application, whatever the band's height or z-index.

## Decision

Every band is a real element, and the rectangle a document needs is drawn by whoever owns that document.

- `apps/desktop/src/window-drag-band.ts` owns the band: the `data-avn-drag-band` attribute, the declarations that make a band draggable, and `installDragBand(doc, { height, background })`, which updates the one band a document carries instead of stacking a second. The preload installs the Windows and Linux caption strip's band through it, so those platforms keep a draggable title strip.
- The macOS start screen renders `<div class="avn-drag-band" aria-hidden="true"></div>` at full width, because that page carries no controls of its own.
- `apps/web/index.html` carries a band inside `#avn-preloader`, and `apps/web/src/preloader.css` styles it under `html[data-avn-traffic-lights]` at the client header row's height. The boot cover itself declares `drag`, and `#avn-preloader.screen-hidden` is `display: none`, so a hidden cover cannot intercept clicks on the toolbar that replaces it.
- `AppFrame` renders `.dragBand` as an element of its frame, one header row tall, `z-index: 29` — above the transcript's scrolling controls, below the header (30) and the sidebars (50). Its `no-drag` holes are unchanged: the window subtracts every control from the band, and the header paints above it.

The gate attribute stays in the preload, because only the carrier knows the platform.

## Alternatives considered

**Keep the pseudo-element and raise its `z-index`.** Rejected: the property is ignored there, so no styling of a `body::before` becomes a draggable region. The regression was invisible in the stylesheet, which is why the sheet's spec asserted declarations that could not work.

**Install the band from the preload into every document.** Rejected for macOS: the application page already draws its band at the header height from `AppFrame`, and a second one would be one rectangle too many; the carrier also has no business knowing the client's header row.

**Let the boot cover be the application's drag region.** Rejected as the only region: the cover leaves the document once the client draws, so the client still needs a band of its own. The cover declaring `drag` covers the frames before that band mounts.

**Keep the band above the header as before.** Rejected: above the header it would absorb the clicks its own `no-drag` holes are there to preserve when a control's hole is missing or new. Below the header, a control that takes drag of its own still reaches the window.

## Consequences

The window can be dragged wherever the page draws a band, which is what the earlier note could not deliver. A band is an element, so it paints and hit-tests like one: the preloader's band disappears with its cover, the start screen's band spans the window, and the application's band sits under the toolbar.

Chromium reads the region from the element's rectangle, so a band's size is now a layout fact rather than a declaration nothing applied. The three bands share one height expression (`calc(8px + var(--dsw-aeven-control-size, 40px))`) and the start screen restates the product's 40 px as the fallback, because no theme stylesheet has loaded when it first paints.

## Verification

`apps/desktop/tests/window-drag-band.spec.ts` pins that `installDragBand` creates one attributed element, updates the band a document already has, keeps it on the document root until the parser creates a body, and carries `-webkit-app-region: drag` and `pointer-events: none`. `apps/desktop/tests/start-screen.spec.ts` pins that only the macOS document carries the element. `packages/client/web/tests/preloader-styles.client.spec.ts` pins the first-paint sheet's band rule, the cover's own drag region, and the hidden cover. The `apps/web/tests/preloader-shell.spec.ts` that guarded the pseudo-element rule is deleted with it. The band was not exercised in a running window here, which needs a macOS launch of the development or packaged shell.
