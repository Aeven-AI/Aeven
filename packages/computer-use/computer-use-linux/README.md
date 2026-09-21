---
description: "Linux desktop adapter for self-contained computer use: compositor-aware window backends, an input ladder, and readiness that names what is missing."
kind: "package-reference"
---

# @aeven/computer-use-linux

English | [中文](README.zh.md)

## Summary

Implements the [`@aeven/computer-use-desktop`](../computer-use-desktop/README.md) contract for Linux — no MCP server, no third-party service, and no bundled binary. It drives the tools the session already has: the compositor's control socket, the X11 utilities, and the Wayland input tools.

Linux is the platform where capability genuinely varies, so this adapter is built around **reporting rather than assuming**. Window control is delegated to whichever backend answers — Hyprland's `hyprctl`, then i3/sway's `i3-msg`, then generic EWMH through `wmctrl` — and input to whichever of `xdotool`, `wtype`, or `ydotool` is present. The report names the backend that answered and lists every one it tried, because an empty window list and a missing backend are indistinguishable to a caller otherwise.

Implemented and covered by tests: `verify()`, `readiness()`, window observation, window focus, and text and key input. The AT-SPI tree and the element-addressed actions are **not** implemented yet, and refuse with `not-implemented` rather than returning an empty tree.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```ts
import { LinuxDesktopAdapter } from '@aeven/computer-use-linux'

const adapter = new LinuxDesktopAdapter({ runner })
const report = await adapter.readiness()
const { snapshot, notes } = await adapter.observe({})
console.log(notes) // which backend answered, and what is not implemented
await adapter.act({ kind: 'type', target: { kind: 'window', pid, windowId }, text: 'the story' })
```

## Understand the implementation

### Backends are data, tried in order

Each window backend declares its command, how to parse that command's own output, and how to focus a window. The adapter tries them in order and reports the winner. This keeps the platform's fragmentation visible and testable instead of hidden behind a single call that sometimes returns nothing.

Unparseable output counts as a failed backend, not as zero windows: a compositor that answered with something unexpected is a different problem from a desktop with no windows.

### Readiness names the blocker

`unknown` is distinct from `blocked`. A missing D-Bus session bus is a session fact, reported as `unknown`; a missing AT-SPI registry is `blocked`, with the setting that enables it. When no window backend answers, the failure lists all three that were tried, and when no input tool answers, the remedy differs for X11 (`xdotool`) and Wayland (`wtype` or `ydotool` with `ydotoold` running).

### Input always names its window

Text and key input require a window target. The adapter focuses that window through a backend first, then sends through the ladder — `xdotool` on X11, then `wtype`, then `ydotool` — so a failure to send is reported as a capability failure rather than silently going to whatever held focus. An unrecognised modifier is refused, never dropped.

## Further Exploration

- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.md) — the contract this implements, including the shared verifier.
- [`@aeven/computer-use-windows`](../computer-use-windows/README.md) and [`@aeven/computer-use-macos`](../computer-use-macos/README.md) — the same contract on the platforms where permission grants, not backends, are the variable.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **The AT-SPI tree is not implemented.** `observe()` returns windows and bounds but no accessibility nodes, so no element token can be produced and element-addressed actions refuse.
- **Click, setValue, and performAction are not implemented**, for the same reason: they need the tree or a pointer path.
- **Not exercised on a real Linux desktop.** Every branch and failure mode is covered against an injected runner, but no test has driven a live session; the readiness claims need an X11 and a Wayland host to be marked verified.
- **The GNOME Shell extension backend is absent.** GNOME Wayland often denies window introspection to unblessed clients, and the upstream remedy is a Shell extension this adapter does not ship; such a session reports `no-window-backend` instead.
- **No screenshot capture**, so the vision rung is unavailable.
- **One process per command**, so a batched session pays process startup per action.

<a id="dev-note"></a>
## Dev Note

The refusal paths carry as much weight as the working ones. An adapter that returned an empty tree when it could not read one would be worse than one that refuses, because the empty tree is indistinguishable from an application that publishes no accessibility surface.

The ladder ordering is deliberately explicit data rather than a chain of conditionals, which is what makes "which backend will be tried, and in what order" a thing a test can state.

**Runtime invariant:** No companion is published because The package is a host-side adapter driven by its caller, so it holds no same-process state across calls and emits no sequence a listener could observe.
