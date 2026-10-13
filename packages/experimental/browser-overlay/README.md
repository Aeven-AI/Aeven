---
description: "The agent's on-screen pointer and action feedback, injected into a browser the model is operating."
kind: "package-reference"
---

# @aeven/experimental-browser-overlay

English | [中文](README.zh.md)

## Summary

Draws the agent's pointer and action feedback into a page the model is operating, so a person watching the browser can see where the agent is about to act and what it just did. The overlay handles no input and reads no page state: a host tells it a coordinate and an action, and it draws. Loading the bundle installs it automatically.

The cursor sprite, its rotation, its two-stop glow, and its motion model are the Codex desktop app's browser-agent cursor, read out of its extracted bundle. The sprite itself is the extracted asset, embedded verbatim.

Long moves select among 20 cubic and segmented-arc candidates using viewport bounds, path length, turn smoothness, and approach direction. Path complexity determines spring timing; short moves use axis-aligned scoot stretch. Travel stretch, rotation, visibility blur, and appearance scale share one frame loop. The idle wobble finishes after 1.41 seconds; holding the pointer keeps it visible without repeating the wobble.

The sprite uses the reference's `(12, -2.5)` offset and 44-degree artwork rotation, compensated by a -44-degree resting model angle. Hosts pass the cursor's target coordinate directly. First appearance can jump to the target; layout corrections replace position without starting a journey.

The Electron sidebar waits for numbered cursor-arrival acknowledgements before discrete input. Hidden panes acknowledge immediately; waits are bounded to 1500ms and cancellation prevents queued chrome input. Scrolling does not wait for arrival or synthesize pointer drift.

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
| `moveTo(point, { mode, label })` | Glides the pointer to a point and names the action; a first appearance fades in 120px short of the point and glides onto it |
| `arrived(signal?)` | Resolves at arrival, hide, destruction, or 1500ms; cancellation rejects |
| `click(point, { label })` | Arrives, expands a ring, flashes, and dwells briefly |
| `type(point, { label })` | Blinks a caret at a point — visually distinct from a click |
| `scroll(point, { deltaY, label })` | Moves the pointer with the gesture, in the direction the content is going |
| `hover(elementOrRect, { kind })` | Rings a target element: `hover`, `region`, or `text` |
| `hide({ immediate })` | Fades the pointer out without detaching, or removes it in one frame with `immediate`; the next action enters afresh |
| `clipTo(rect)` | Confines everything drawn to a viewport rectangle; `undefined` releases it |
| `setThinkEnabled(bool)` | Turns the idle wobble off, for screenshotting or measuring |
| `destroy()` | Removes the overlay, its stylesheet, and every listener |

Prefer passing an `Element` to `hover`. A rectangle is a snapshot, so a scroll leaves the box behind; an element reference is re-measured on scroll and resize.

`attach({ container, sound, idleHideMs, decorations })` takes the overlay's own settings. `container` is the element it draws in, which is what makes points coordinates inside a host's pane rather than the window. `sound` emits a short click sound per action, off by default. `idleHideMs` is the idle fade, `0` keeping the pointer visible.

`decorations` draws what marks a target or a moment rather than the pointer — the box around a named target, the ring and flash of a click, and a typing action's caret. It is on by default. Passing `false` leaves the pointer alone on screen, for a host whose page belongs to a reader: with it off the overlay creates no box and no label, `hover` draws nothing, and `click` and `type` place the pointer without either mark.

Points are viewport coordinates in CSS pixels, and the anchor is the arrow's **tip**: the cursor box origin is placed exactly on the coordinate you pass, and the arrow's body extends down and to the right from there, as a conventional pointer does. `demo/measure-tip.mjs` asserts this to within two pixels.

<a id="verify-cursor-geometry"></a>

### Verify the cursor's geometry

```sh
node packages/experimental/browser-overlay/demo/measure-tip.mjs
```

Asserts the reference's sprite offset, 44-degree artwork rotation, and -44-degree resting model angle, and reports the rendered tip position.

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
- **No per-action sprite.** Movement rotates and stretches the same sprite; pressing and typing use the same artwork.
- **Host-owned input.** The Electron sidebar supplies pointer actions and arrival acknowledgements; other consumers must supply their own input ordering.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The two demo scripts are the regression suite. `measure-tip.mjs` guards the one invariant that is invisible in code review — that the arrow points where the host said — and `run.mjs` guards the visual states plus teardown.

</details>

**Runtime invariant:** No companion is published because the overlay is a browser client half that reacts to pointer state handed to it by the host, so it owns no host-side ordering and keeps no cross-call state a listener could compare; the demo scripts listed above are its regression surface.
