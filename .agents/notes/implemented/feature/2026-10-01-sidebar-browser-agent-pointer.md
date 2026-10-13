# Agent Note: The agent pointer in the browser pane

Status: implemented

English | [中文](2026-10-01-sidebar-browser-agent-pointer.zh.md)

## Problem

The right sidebar's browser pane draws the agent's pointer over the guest. Four properties had no single owner and each failed visibly. The pointer aimed at an element's **left edge** for chrome controls, because the one targeting rule in the pane existed for the address field, where the typed text starts at the field's left; on a button that put the arrow left of what it pressed. A popup painted **over** the pointer: the three-dot menu mounts as a portal, and its backdrop blur dimmed and smeared the arrow behind the menu. The chrome controls **could not be pressed at all** through the app's bridge — `reload`, `back` and `forward` were rejected as unknown operations, so the pointer that shows an action had no way to reach the buttons it was meant to press. And the pointer **outlived the layout it was placed on**: a page that scrolled under a resting pointer left the arrow where the element had been, and a target-less scroll started from a stale record of the pointer's position, so the arrow entered the page at the viewport's middle rather than from where the reader last saw it.

## Decision

**Aiming is by target kind.** A button or a link takes the centre of its box, on both axes. The address field alone takes its left edge plus `ADDRESS_TEXT_INSET_PX`, because the address is text that begins there. The pane's `centreOf` (elements) and `leftOf` (the address field) name the two cases, so the rule is legible at the call site instead of living in a comment. The reference sprite geometry accepts the named coordinate directly, with no additional tip offset.

**The pointer's layer lives in the page's top layer.** It is portaled to `BODY` as `position: fixed` with `z-index: 1300`, and its box is written from the pane's rectangle on mount, on window resize, and on scroll. Portaling is the requirement, not a preference: the menu is a `position: fixed; z-index: 1100` portal directly under `BODY`, so it is a sibling of the entire pane subtree, and no z-index inside that subtree can paint above it. A popup with `backdrop-filter` blurs everything painted below it, which is what made the pointer dim and smeared.

**A chrome control is named, not positioned by the shell.** The cursor payload carries `action: 'control'` with a `control` name (`back`, `forward`, `refresh`, `capture`, `more`, `zoom-in`, `zoom-out`, `zoom-reset`, or `navigate` for the address field). The shell names the control; the pane finds it, places the pointer on its centre, and clicks it. Controls are looked up in the pane's own chrome row first, then among visible elements anywhere in the document, because the three-dot menu's rows are portaled out of the pane. Input timing and cursor geometry follow the [bounded arrival and reference motion decision](2026-10-10-browser-pointer-arrival-and-reference-motion.md). A chrome action also clears the shell's record of the pointer's page position, because the pointer leaves the page for a row that is not in it.

**A page that moves puts the pointer back on its element.** The guest reports its own scrolls: the desktop adds a CDP binding to each guest and installs a reporter into every document — `Page.addScriptToEvaluateOnNewDocument` covers the documents created after it, and each navigation installs the reporter into the document that navigation opens, because an install that ran between two documents would otherwise leave a binding nothing calls. The host window forwards each report to the pane, which re-measures the element it is on and places the pointer on that element, throttled while the movement continues and once more after it stops. A shell scroll suppresses anchor corrections while its gesture is active and records the interaction origin for the next target-less scroll. Layout corrections replace position without creating an animated journey.

**The pane draws the pointer and nothing else.** The overlay is attached with `decorations: false`, so it creates no box and draws no click ring, click flash, or typing caret. The page's own reaction is what shows an action landing, and a mark the agent leaves on a page the reader is reading is not the overlay's to add. What survives is the pointer's own motion: it travels to what it acts on, presses it, and holds there until its idle fade.

## Alternatives considered

- **Raising the pane's z-index** above the menu: the menu is a sibling of the pane, so this hides the menu behind the pane's content instead of lifting the pointer over the menu.
- **Keeping the pointer layer inside the pane** and giving it a larger z-index: measured to fail — the whole pane subtree loses to the menu's own layer, whatever the descendant carries.
- **Waiting indefinitely for arrival before pressing**: background rendering may never advance; the bounded wait is owned by the reference motion decision.
- **Aiming controls at their left edge**, inheriting the address field's rule: measured at −16 px on the horizontal axis, which is the offset the reader reported as the pointer sitting left of the button.
- **Ringing the element the pointer acts on**: the ring was drawn and measured exactly onto its element, and removed at the reader's request — it marks a page the reader is reading, and the pointer's own position already says what it is acting on.
- **Re-aiming the pointer while the shell performs a scroll**: measured as a fight — the pane placed the pointer back on its element between the gesture's own steps, so the pointer lagged the page it was scrolling.
- **Having the pane poll the guest's scroll offset**: rejected — either a measurement across the bridge on every frame, or a guessed interval, where the page itself can report the moment it moves.

## Consequences

The pointer belongs to the window rather than to the pane, so any change to the pane's geometry must re-place its box; the pane owns that synchronization. Each pressed control needs a `data-control` name, and a control without one cannot be reached by the pointer. The address field stays the single aiming exception. The reference motion decision owns the sprite geometry. Re-aiming depends on two installs a guest can refuse: a debugger-attached binding and a per-document reporter. A guest that cannot take them reports the failure to the app's own log, and its pointer then stays where the last action put it; nothing else degrades. Each reported scroll costs the pane one measurement of the anchored element, and a page scrolling continuously is measured on the pane's throttle rather than once per report. Only the pointer's own motion is drawn, so the overlay's box, ripple, flash, and caret stay uncreated for this pane and a caller wanting them must attach an overlay without `decorations: false`.

## Verification

The original live pane measurements establish the portal's visibility above the menu and the control targeting integration. Current motion validation comprises TypeScript, full build, and desktop build checks; frame-by-frame rendering and the geometry demos remain unverified under the requested validation limit.
