---
description: "Shared adapter contract for self-contained desktop computer use on macOS, Windows, and Linux."
kind: "package-reference"
---

# @aeven/computer-use-desktop

English | [中文](README.zh.md)

## Summary

Every platform adapter implements one small contract, so a recipe written against it runs on macOS, Windows, and Linux without a platform branch. The contract has four operations: observe one coherent view of windows and accessibility nodes, attempt an action, verify the result by an independent read-back, and report which capabilities actually work on this host.

Two rules are part of the types rather than advice beside them. `act()` returns a receipt of what was attempted and observed, and cannot express success, so a caller that needs certainty must call `verify()`. And an element token is valid only against the snapshot that produced it, so acting on a stale token fails with a named error instead of reaching whatever now occupies that position.

This package contains no platform code. It exists so the three adapters cannot drift apart.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Implement `DesktopAdapter` in a platform package and hand it to a consumer that routes work to it:

```ts
import type { DesktopAdapter } from '@aeven/computer-use-desktop'

const result = await adapter.observe({ pid: 42, windowId: 'w1' })
const node = resolveNode(result.snapshot!, result.snapshot!.nodes[0].token)
await adapter.act({ kind: 'click', target: { kind: 'element', token: node.token } })
await assertVerified(await adapter.verify([{ kind: 'fileExists', path: '/tmp/out.pages' }]), 'save document')
```

## Understand the implementation

### Observation is scoped

`observe()` takes an `ObserveScope`, so scanning the whole desktop is never the accidental default. A scope may name a process, a window, or neither; a tree is cheaper than a capture, so pixels are requested explicitly.

### An action cannot claim success

`ActionReceipt` records the route used and what the adapter could observe. It has no success field. A caller establishes that work happened by calling `verify()` with expectations it can re-read independently, such as a file's contents or an element's value.

This shape exists because action acknowledgements are unreliable in practice: a driver may report that it delivered keystrokes while the target file never changed.

### Tokens are snapshot-scoped

`resolveNode()` refuses a token from another snapshot with code `stale-token`, and `assertAdvertisedAction()` refuses an accessibility action the node does not expose. Both failures name the offending token, so a caller can report a real reason instead of a generic error.

### Capability is reported, not assumed

`ReadinessReport` carries one probe per capability with a state of `ready`, `blocked`, or `unknown`, plus the OS identity each grant attaches to. `unknown` is deliberately distinct from `blocked`: a probe that could not run is not a missing permission. `composeReadinessReport()` derives the blocker list from the probes, so a report cannot disagree with itself.

## Further Exploration

- [`@aeven/computer-use`](../computer-use/README.md) — exclusive provider registration for a deployment.
- [Codex computer-use skills](../../../docs/subsystems/computer-use.md) — the reference session model this contract is designed to serve.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No service registration yet.** This package defines the contract and its guards. Wiring a provider into `ctx.computerUse` and exposing a model-facing session arrives with the platform adapters.
- **No platform implementation.** macOS, Windows, and Linux adapters are separate packages; nothing here can observe or act on its own.
- **Capability parity is not guaranteed.** Linux cannot promise a compositor backend on every desktop, so callers must consult `readiness()` rather than assume an operation is available.

<a id="dev-note"></a>
## Dev Note

The contract deliberately has no "did it work" return value anywhere. Every failure mode this package guards against was observed in practice: unscoped input reaching the wrong window, a stale element index resolving to a different control, and an action acknowledging delivery while the observable never changed.

The types module carries no runtime code, so the contract costs nothing to depend on; `guard.ts` holds the runtime validation and is covered by its own suite.

**Runtime invariant:** No companion is published because The package declares the desktop contract and its guards as pure data, so it emits no event sequence and maintains no mutable relation; a consumer that drives an adapter owns those.
