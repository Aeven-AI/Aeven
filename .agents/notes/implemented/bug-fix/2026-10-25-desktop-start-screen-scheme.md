# Agent Note: Desktop start screen paints the Appearance preference

Status: implemented

English | [中文](2026-10-25-desktop-start-screen-scheme.zh.md)

## Problem

The start screen carried `color-scheme: light dark` and a `prefers-color-scheme: dark` media query, so it painted in whatever scheme the operating system reported. A user who chose Dark in the product's Appearance setting while the operating system stayed light saw a light start screen, which then changed colour when the client preloader took over. The launch status line carried three sentence-long release-step messages naming the version, in a 13px line up to 440px wide, so the text outweighed the mark the screen exists to show.

## Decision

`readStartScreenScheme(file)` reads the Host's settings document — `settings.yaml` under `resolveAvnHome()` — and returns its `ui-theme.preference`, the field the Appearance row writes: `light`, `dark`, or `system`. The start screen paints before any Host runs, so the shell reads the document itself instead of asking the settings service. A document that is absent (it exists only once a setting changes), unparsable (the Host refuses it at boot and reports that there), or holding no built-in preference returns `system`, the Host's own default. `startPageDocument(platform, scheme = 'system')` paints a built-in scheme as `color-scheme: <scheme>` with that scheme's palette and no media query, while `system` keeps the media query; `brandDocumentHead` accepts a single-scheme value for its meta tag.

The launch status line carries one short phrase with no version and no step: "Checking for updates" for a launch that queues an update check, and "Installing update" for every install step. It sits at 11px in `min(80vw, 260px)` at 0.55 opacity, still positioned out of the loading face's flow, so a line appearing moves neither the mark nor the spinner.

## Alternatives considered

**Reading the preference through the Host's settings service** waits for the Host, which starts after this page has painted. **Keeping the media query only** is what the previous screen did, and it contradicts a scheme the user chose in the product. **Rendering the client's preloader in this page** would load a client bundle to paint two colours the shell already has.

## Consequences

The start screen and the client preloader show the same scheme, so the handover no longer changes colour. The shell carries the two palettes as CSS custom properties, while the preference itself has one source, the settings document; a built-in preference changed in Settings reaches the screen on the next start, because each start-page request re-reads the document. The status line no longer names the version being installed or the step the install reached.

## Related

The screen's face, its origin, and its handover are owned by [the desktop start screen](../feature/2026-10-16-desktop-start-screen.md); this note covers the scheme it paints in and what the status line says.
