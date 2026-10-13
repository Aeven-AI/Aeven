---
description: "macOS desktop adapter for self-contained computer use: readiness probes that name the granting identity, window-scoped input, and filesystem verification."
kind: "package-reference"
---

# @aeven/computer-use-macos

English | [中文](README.zh.md)

## Summary

Implements the [`@aeven/computer-use-desktop`](../computer-use-desktop/README.md) contract for macOS using the operating system's own facilities — no MCP server, no third-party service, and no bundled native code.

Implemented and tested: `verify()` reads the real filesystem, which is the strongest and most portable evidence that work actually happened; `readiness()` probes Accessibility, Screen Recording, and per-target Automation and reports **which OS identity holds each grant**, because on macOS a spawned helper carries its own grants rather than inheriting Æven's; `observe()` walks the accessibility tree and mints snapshot-scoped element tokens; and the element-addressed actions (`AXPress`, `AXSetValue`, and advertised secondary actions) go through `AXUIElement`. Input is always scoped to an exact window, since an unscoped keystroke can reach a sibling window of the same process.

The tree walk needs the **Accessibility grant held by the process that runs it**. A spawned helper does not hold Æven's grant and is measured to receive `-25201 kAXErrorAPIDisabled`, so that case is reported as a capability failure naming the grant — never as an empty node list, which would be indistinguishable from an application with no accessibility surface.

The walk itself runs through AppleScriptObjC, so no native code is compiled. It emits a flat roster and TypeScript does the indexing, which keeps token assignment and bounds computation in ordinary tested code.

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
import { MacDesktopAdapter, type MacCommandRunner } from '@aeven/computer-use-macos'

declare const runner: MacCommandRunner

const pid = 4711
const windowId = 'w1'
const output = '/Users/me/Desktop/story.pages'
const startedAt = Date.now()

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

### Tokens are snapshot-scoped and replayed

A token is `<snapshotId>:<walkIndex>`, and the snapshot id carries the owning pid and window, so a token is self-describing. An action replays the **same depth-first walk** the snapshot used and stops at that index, so it resolves the same element or fails — never a different one. The node's advertised actions are checked before the call, and a refusal lists what the node does advertise.

### Verification never trusts an action

`verify()` re-reads the observable from the operating system. A file that cannot be read is `satisfied: false` with the reason, never a pass, and a check that threw reports the error instead of assuming the best.

## Further Exploration

- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.md) — the contract this implements, and the verifier it shares.
- [`@aeven/computer-use-windows`](../computer-use-windows/README.md) — the same contract on Windows, where UI Automation needs no grant.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **The AX walk only goes as far as the grant allows.** Routing it through `osascript` cannot read a tree on a host that has not granted Accessibility to that binary (`-25201`); moving the walk in-process is what makes Æven's own grant apply.
- **Coordinate clicks are not implemented.** macOS has no single point to press on a window, and a pointer path through CGEvent is not built yet, so `click` must address an element.
- **The walk visits the frontmost application.** Multi-window applications are observed by their front window, and a window id is its title, because System Events exposes no stable window identifier.
- **The walk is not verified against a live desktop here.** Every parser, refusal, and action path is covered by tests, but the `-25201` result is the only behaviour observed on a real host.
- **The runner shells out.** Today every command runs as a spawned helper, so it carries its own grants rather than Æven's. Moving AX and input in-process is what collapses that to a single grant.
- **Automation prompts cannot be collapsed.** macOS grants Apple Events per target application, so each newly scripted app costs one consent dialog the first time.

<a id="dev-note"></a>
## Dev Note

The refusal path is the point of the design, not an oversight. An adapter that returned an empty tree would be worse than one that names the missing grant: the empty tree is indistinguishable from an application with no accessibility surface, which cost a measured twenty-plus calls before the difference was understood.

The walk script is the one part that cannot be unit tested here, since it requires a granted process to run. Its failure mode was found by executing it for real: `$.exit` is not a function in osascript, so the script now emits its envelope and then throws, which produces the non-zero status without losing the machine-readable reason.

Readiness and verification were built first because they are what make an action trustworthy. Both are fully testable without a Mac — the runner is injected, so every branch, including each failure mode, is covered.

**Runtime invariant:** No companion is published because The package is a host-side adapter driven by its caller, so it holds no same-process state across calls and emits no sequence a listener could observe.
