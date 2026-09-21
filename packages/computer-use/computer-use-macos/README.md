---
description: "macOS desktop adapter for self-contained computer use: readiness probes that name the granting identity, window-scoped input, and filesystem verification."
kind: "package-reference"
---

# @aeven/computer-use-macos

English | [中文](README.zh.md)

## Summary

Implements the [`@aeven/computer-use-desktop`](../computer-use-desktop/README.md) contract for macOS using the operating system's own facilities — no MCP server, no third-party service, and no bundled native code.

Three things are implemented and tested. `verify()` reads the real filesystem, which is the strongest and most portable evidence that work actually happened. `readiness()` probes Accessibility, Screen Recording, and per-target Automation, and reports **which OS identity holds each grant**, because on macOS a spawned helper carries its own grants rather than inheriting Æven's. Input is always scoped to an exact window, since an unscoped keystroke can reach a sibling window of the same process.

Observation and the accessibility actions are deliberately **not** implemented yet. They need an AX tree walker, which requires the Accessibility grant held by the calling process; a spawned helper does not have it and is measured to receive `-25201 kAXErrorAPIDisabled`. Those paths refuse with `not-implemented` and name the missing piece, rather than returning an empty tree that would be indistinguishable from an application with no UI.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Construct the adapter with a command runner and verify an outcome independently of the action that produced it:

```ts
import { MacDesktopAdapter } from '@aeven/computer-use-macos'

const adapter = new MacDesktopAdapter({ runner, holder: { name: 'osascript', source: 'spawned-helper' } })
const report = await adapter.readiness()
await adapter.act({ kind: 'key', target: { kind: 'window', pid, windowId }, key: 's', modifiers: ['cmd'] })
const [saved] = await adapter.verify([{ kind: 'fileNewerThan', path: output, sinceMs: startedAt }])
if (!saved?.satisfied) throw new Error('the save did not reach disk')
```

## Understand the implementation

### Readiness names the identity, not just the state

A report that says only "Accessibility: denied" is not actionable. Each gated probe carries a `grantee`, so the remedy can say exactly which process needs the grant — the difference between "grant Æven access" and a user hunting through System Settings.

Automation is probed **per target application**, because macOS grants it per (controller, target) pair. The adapter attributes that grant to the spawned helper that holds it, not to Æven.

### Input cannot be sent unscoped

`type` and `key` refuse a target that does not name a window. Synthesised keystrokes follow focus, so an unnamed target is how input reaches the wrong window; measured behaviour included a background save that reported success while writing nothing.

Named keys map to virtual key codes, because `keystroke` cannot express keys like Return. An unrecognised modifier is refused rather than dropped, so a chord never silently loses a modifier.

### Verification never trusts an action

`verify()` re-reads the observable from the operating system. A file that cannot be read is `satisfied: false` with the reason, never a pass, and a check that threw reports the error instead of assuming the best.

## Further Exploration

- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.md) — the contract this implements, and the verifier it shares.
- [`@aeven/computer-use-windows`](../computer-use-windows/README.md) — the same contract on Windows, where UI Automation needs no grant.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Observation is not implemented.** `observe()` refuses with `not-implemented` until an AX tree walker lands, so no snapshot or element token can be produced yet.
- **Click, setValue, and performAction are not implemented**, for the same reason: they address elements, which requires a snapshot.
- **The AX walk needs an in-process caller.** Routing it through `osascript` cannot work, because the Accessibility grant belongs to the spawned binary.
- **The runner shells out.** Today every command runs as a spawned helper, so it carries its own grants rather than Æven's. Moving AX and input in-process is what collapses that to a single grant.
- **Automation prompts cannot be collapsed.** macOS grants Apple Events per target application, so each newly scripted app costs one consent dialog the first time.

<a id="dev-note"></a>
## Dev Note

The unimplemented paths are the point of the design, not an oversight. An adapter that returned an empty tree would be worse than one that refuses: the empty tree is indistinguishable from an application with no accessibility surface, which cost a measured twenty-plus calls before the difference was understood.

Readiness and verification were built first because they are what make an action trustworthy. Both are fully testable without a Mac — the runner is injected, so every branch, including each failure mode, is covered.
