---
description: "Windows desktop adapter for self-contained computer use: UI Automation with no permission grant, semantic pattern actions, and window-scoped input."
kind: "package-reference"
---

# @aeven/computer-use-windows

English | [中文](README.zh.md)

## Summary

Implements the [`@aeven/computer-use-desktop`](../computer-use-desktop/README.md) contract for Windows using UI Automation and PowerShell — no MCP server, no third-party service, and no bundled native code.

Windows is the least gated of the three platforms and the adapter is shaped around why. **UI Automation needs no permission grant** and exposes genuine semantic patterns, so `observe()` reaches the tree directly and `setValue`/`performAction` write through patterns such as `ValuePattern` instead of synthesising keystrokes. Because a pattern write names its element rather than following focus, it cannot be delivered to the wrong window — which is why the semantic route is the default here and synthesised input is the fallback.

Synthesised input remains available for what patterns cannot express, and it is always scoped: every path fronts the exact window first and reports honestly when fronting did not happen.

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
import { WindowsDesktopAdapter, type WindowsAdapterOptions } from '@aeven/computer-use-windows'

// The command runner is the caller's: this package owns the adapter, not the seam.
declare const runner: WindowsAdapterOptions['runner']

const adapter = new WindowsDesktopAdapter({ runner })
const { snapshot } = await adapter.observe({ windowId: '100' })
const body = snapshot?.nodes.find(node => node.role.includes('Edit'))
if (body === undefined) throw new Error('the window published no editable node')
await adapter.act({ kind: 'setValue', target: { kind: 'element', token: body.token }, value: 'the story' })
const [written] = await adapter.verify([{ kind: 'nodeValueEquals', token: body.token, value: 'the story' }])
```

## Understand the implementation

### Tokens name their window

A node token is `<windowId>:<ordinal>`, where the ordinal is the element's position in a breadth-first walk of that window. Resolution replays the same traversal, so a token cannot silently address a different control, and a malformed token is refused before any PowerShell runs.

Because UI Automation enumerates a window's subtree rather than the whole desktop, observation is scoped by construction rather than by convention.

### Patterns before keystrokes

`setValue` and `performAction` address an element, so they need no focus and work on a backgrounded window. `performAction` refuses a pattern the element does not advertise and lists what it does advertise, rather than invoking something that merely has a similar name.

### Synthesised input always fronts its exact window

`type`, `key`, and coordinate `click` are the fallback route. Each one fronts the target window and then **verifies that it actually came to the foreground**, failing loudly if it did not — because synthesised input follows the foreground, so a silently unsent front is how a keystroke reaches a different application. Typed text is escaped so characters such as `%` and `+`, which SendKeys reads as modifiers, are inserted literally.

### Readiness says what is and is not gated

The report states plainly that UI Automation requires no grant. A failure to reach the desktop is reported as `unknown` rather than `blocked`, because the cause is an unreachable session rather than a permission the operator could grant. Elevation is probed separately: an unelevated process can list an elevated application's window but not drive it, and that is a different problem from a missing grant.

## Further Exploration

- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.md) — the contract this implements, including the shared verifier.
- [`@aeven/computer-use-macos`](../computer-use-macos/README.md) — the same contract where Accessibility and Automation must be granted per identity.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Not exercised on a real Windows host.** The adapter, its fragments, and every failure mode are covered by tests against an injected runner, but no test has driven a live desktop; the ready/blocked claims need a Windows host to be marked verified.
- **PowerShell resolution mirrors `@aeven/pwsh-local` rather than importing it**, because that package is a Cordis executor with five peer dependencies. The candidate order is the same; a divergence would need to be kept in step by hand.
- **Fragments run one PowerShell process per call**, so a batched session pays process startup per action until a persistent shell is added.
- **No screenshot capture yet.** `observe()` returns the tree and window bounds but no pixels, so the vision rung is unavailable on Windows.
- **60-odd processes and long trees can be slow.** The node cap bounds one walk, but nothing yet caches or diffs successive snapshots.

<a id="dev-note"></a>
## Dev Note

The verifier is not implemented here: it lives in `@aeven/computer-use-desktop`, because the filesystem checks are identical on every platform and three copies would drift.

Everything is written against an injected command runner, which is why the suite covers each failure mode — an unreachable desktop, an unreadable envelope, a failed pattern, a malformed token — without a Windows machine.

**Runtime invariant:** No companion is published because The package is a host-side adapter driven by its caller, so it holds no same-process state across calls and emits no sequence a listener could observe.
