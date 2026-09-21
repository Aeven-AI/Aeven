---
description: "The agent's on-screen pointer and action feedback, injected into a browser the model is operating."
kind: "package-reference"
---

# @aeven/experimental-browser-overlay

English | [中文](README.zh.md)

## Summary

Draws the agent's pointer and action feedback into a page the model is operating, so a person watching the browser can see where the agent is about to act and what it just did. The overlay handles no input and reads no page state: a host tells it a coordinate and an action, and it draws. Loading the bundle installs it automatically.

The cursor sprite, its rotation, its two-stop glow, and its motion model are the Codex desktop app's browser-agent cursor, read out of its extracted bundle. The sprite itself is the extracted asset, embedded verbatim.

Motion is spring-driven and interrupted-friendly: a long move arcs along a quadratic Bézier with the cursor banked into the turn, a short one scoots with a brief overshoot, and a redirect mid-flight keeps its velocity instead of restarting. Past arrival the cursor holds a short damped wobble before settling. The integrator is React Spring's, reproduced rather than re-derived, because a spring with the same nominal damping and response but a different solver does not produce the same motion.

The sprite rests **unrotated**, in the orientation its artwork is authored in, and is **centred in its box**. Both are asserted by `demo/measure-tip.mjs`; see [Verify the cursor's geometry](#verify-cursor-geometry).

One consequence is worth stating plainly: the arrow's tip is the sprite's top-left corner, so centring the sprite leaves the tip about 9px up and to the left of the coordinate you pass. That is the trade centring makes. If you would rather the tip sit exactly on the coordinate, move `CURSOR_NUDGE` in `src/styles.ts` so the tip lands on the box centre and accept that the sprite's visual weight shifts down-right.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Bundle `src/index.ts` for the browser and inject it at document start, then drive it from wherever the actions are dispatched:

```js
await session.send('Page.addScriptToEvaluateOnNewDocument', { source: bundle })
await session.send('Runtime.evaluate', { expression: 'window.__aevenOverlay.click({ x: 120, y: 340 }, { label: "click Save" })' })
```

| Call | What it draws |
|---|---|
| `moveTo(point, { mode, label })` | Glides the pointer to a point and names the action |
| `click(point, { label })` | Arrives, expands a ring, flashes, and dwells briefly |
| `type(point, { label })` | Blinks a caret at a point — visually distinct from a click |
| `scroll(point, { deltaY, label })` | Nudges a chevron in the scroll direction |
| `hover(elementOrRect, { kind })` | Rings a target element: `hover`, `region`, or `text` |
| `hide()` | Hides the pointer without detaching |
| `setThinkEnabled(bool)` | Turns the idle wobble off, for screenshotting or measuring |
| `destroy()` | Removes the overlay, its stylesheet, and every listener |

Prefer passing an `Element` to `hover`. A rectangle is a snapshot, so a scroll leaves the box behind; an element reference is re-measured on scroll and resize.

Points are viewport coordinates in CSS pixels, and the anchor is the arrow's **tip**: the cursor box origin is placed exactly on the coordinate you pass, and the arrow's body extends down and to the right from there, as a conventional pointer does. `demo/measure-tip.mjs` asserts this to within two pixels.

<a id="verify-cursor-geometry"></a>

### Verify the cursor's geometry

```sh
node packages/experimental/browser-overlay/demo/measure-tip.mjs
```

Asserts that the sprite is centred in the cursor box to within 0.01px, that the sprite layer carries no transform of its own, and that the resting rotation is zero. It reports the tip position for information rather than asserting it, for the reason given above.

Run it after any change to the sprite, the nudge, the rotation, or the transform composition. A screenshot cannot check any of these: a centred arrow and a ten-pixel-off arrow look the same in a PNG, and a tilted sprite is indistinguishable from tilted artwork.

The script turns the idle wobble off first. That is not a detail: the wobble rotates the sprite by design, so measuring while it runs returns a different angle on every frame — a limit cycle that looks like a calibration bug and is not one.

### See every state

```sh
node packages/experimental/browser-overlay/demo/run.mjs
```

Drives all seven states against a demo page and writes screenshots to `demo/out/`, asserting as it goes: the sprite is the copied asset at its authored size, the pointer anchors on the coordinate, the hover box survives a scroll, the overlay never accepts pointer events, and `destroy()` leaves no nodes or stylesheets behind.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The overlay is one root element appended to `documentElement` — not `body`, so a page that replaces its body does not orphan it. Everything lives under an `aeven-browser-overlay` class prefix and inside a single injected stylesheet, so nothing can leak into the page's own styles and teardown can remove the whole surface at once.

`contain: layout style` isolates layout and style calculation, but deliberately not `contain: paint`: paint containment would make the root a containing block for its own `position: fixed` children, anchoring them to the root instead of the viewport. The sprite's size is pinned against a page's global `img` rules so its rendered size cannot drift.

The sprite is an `<img>` with a base64 data URI rather than a file: a relative asset URL would resolve against the target page's origin, and a fetch could be blocked by the page's CSP. A data URI can do neither.

Injected at document start, a bundle runs before the parser creates a root element. `attach()` therefore builds its elements regardless and appends them once the document is ready, which is why `installOverlay()` is safe at any point in the document lifecycle and why calling an action before then is a no-op rather than an error.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Cua Driver MCP provider](../computer-use-cua-driver-mcp/README.md) — the provider whose browser actions this overlay accompanies. Its `browser_*` tools are what a caller would feed the overlay.
- [Experimental packages](../README.md) — the group this package belongs to.

-----

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

This overlay draws what a host tells it and verifies nothing about the page.

- **Host-driven, not self-observing.** The overlay never installs page listeners to infer actions. A host that forgets to call it shows no feedback, and a host that reports an action that did not happen draws a confident pointer at a point nothing touched.
- **One instance per document.** Installation is idempotent through a `window` global. Two bundles from different hosts would share one overlay rather than each drawing its own.
- **No cross-frame coverage.** An iframe's contents are a separate document; the overlay covers only the document it is installed into.
- **Rotation is a transient bank, not a pose.** The sprite rests unrotated and leans by at most 70° while travelling along an arc, settling back to zero. There is no per-action pose (pressing, typing, dragging) beyond the distinct caret and ripple.
- **The tip is not the anchor.** Centring the sprite puts the arrow's tip about 9px up-left of the coordinate, because the tip is the sprite's top-left corner. See the note in the summary for the alternative.
- **Not yet wired to a provider.** This package draws; nothing calls it yet. Connecting it to the `browser_*` tool results of a browser provider is the remaining work.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The two demo scripts are the regression suite. `measure-tip.mjs` guards the one invariant that is invisible in code review — that the arrow points where the host said — and `run.mjs` guards the visual states plus teardown.

</details>

**Runtime invariant:** No companion is published because the overlay is a browser client half that reacts to pointer state handed to it by the host, so it owns no host-side ordering and keeps no cross-call state a listener could compare; the demo scripts listed above are its regression surface.
