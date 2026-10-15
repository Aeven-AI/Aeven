---
description: "The Windows computer-use provider for Æven: mounts the adapter, session, router, executor and COM handler as one plugin and claims the exclusive registration slot."
kind: "package-reference"
---

# @aeven/computer-use-windows-provider

English | [中文](README.zh.md)

## Summary

The composition-facing half of Windows computer use. It assembles the adapter, session, recipe router, executor and COM handler into one object, publishes it on the context, and claims the exclusive provider slot through [`@aeven/computer-use`](../computer-use/README.md).

It exists so that mounting Windows computer use is one row in a composition rather than five objects a deployment has to wire in the right order. The order matters: the seam is consulted **before** the provider is published, because a second provider must be refused with the name of the one already registered. The `package` returned by that seam is what makes the whole contribution reversible — unloading the plugin releases the slot again.

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
import * as computerUseWindowsProvider from '@aeven/computer-use-windows-provider'

// In a composition, as one row:
//   '@aeven/computer-use': {}
//   '@aeven/computer-use-windows-provider': {}
```

`inject: ['computerUse']` is declared as `inject` on the plugin, so the row waits for the registry rather than failing when it is mounted first. A deployment that runs the Cua Driver MCP provider can set `register: false`, which publishes the provider for its session and batch tool while leaving the slot to the driver; that is how the Web bundle mounts this row.

`computer_use_run` accepts 1 to 20 `execute`, `observe`, or `readiness` steps. An execute step names a recipe task, an optional application automation identifier, and string parameters; the result includes per-expectation outcomes and `verified`. Each call owns a fresh session and forwards cancellation to host commands. Execution steps require write access and explicit approval; observation and readiness do not request execution approval.

`powershell` names the executable every host command runs through and defaults to `powershell` on `PATH`, which ships with Windows. PowerShell 7 is used when a deployment names it.

## Understand the implementation

### The seam decides duplicates, not the service store

The provider calls `ctx.computerUse.register(providerName)` **before** `ctx.provide('windowsComputerUseProvider', provider)`. Publishing first would let Cordis's own "service already registered" error win, which names the slot but not the owner, and names it in Cordis's vocabulary rather than this seam's. Ordering the calls this way makes the refusal say which provider is already there.

### The context property has its own name

The macOS provider publishes `ctx.computerUseProvider`; this one publishes `ctx.windowsComputerUseProvider`. Cordis declares a service by augmenting `Context`, and two declarations of one property with different provider types cannot sit in one program, so a single shared name would make the two platform providers mutually exclusive at compile time rather than at run time.

### `provide`, not `set`

A property has to be claimed before it can hold a value. `ctx.set` on an unclaimed name throws, and the disposer that `ctx.provide` returns is what releases the slot when the fiber unloads.

### One handler set for the executor and the session

Both are constructed from the same `com` handler, because a task that resolves in one and fails in the other would be a task this package invented. The handler is built from the same runner the adapter uses, so every host command runs through one PowerShell resolution.

### Nothing is claimed that cannot be released

The provider owns no timers, no listeners and no processes of its own. Everything it publishes is disposed with the fiber, so a stop, update or undefine leaves no half-mounted provider behind.

## Further Exploration

- [`@aeven/computer-use`](../computer-use/README.md) — the exclusive slot this provider claims, and the seam that refuses duplicates.
- [`@aeven/computer-use-windows`](../computer-use-windows/README.md) — the UI Automation and input adapter the provider publishes.
- [`@aeven/computer-use-windows-com`](../computer-use-windows-com/README.md) — the semantic mechanism the batch tool executes through.
- [`@aeven/computer-use-executor`](../computer-use-executor/README.md) — the verification that decides whether a task actually succeeded.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No COM task has been run on a real host.** The adapter and the handler are unit-tested, and the Office recipes are tagged `documented` rather than `verified`. Driving a live Excel, Word, or PowerPoint is the missing evidence, and it is why the Web bundle mounts this row behind `register: false` rather than as the only provider.
- **The default recipe book is the starter book.** A deployment supplies its own through `recipes`.
- **No Linux provider exists.** [`@aeven/computer-use-linux`](../computer-use-linux/README.md) has an adapter and no composition-facing half, so a Linux host reaches computer use through the Cua Driver MCP provider alone.
- **Nothing in this package can run on a non-Windows host.** PowerShell and UI Automation are the mechanisms, so the batch tool is registered wherever the row loads but a task fails there; the composition guards the row with `process.platform !== 'win32'`.

<a id="dev-note"></a>
## Dev Note

The provider was written against the macOS one rather than from scratch, because the two differ in exactly three things: the mechanism handler that is wired in, the platform a batch step declares, and the readiness report, which describes capabilities here instead of permission grants.

The context property name was the one deliberate divergence. A first draft declared `computerUseProvider` with the Windows provider type, which compiles while only one of the two packages is in a program and breaks the moment anything imports both — a failure mode that would appear in a consumer rather than here, so the name changed instead.

**Runtime invariant:** No companion is published because the package assembles the other packages and claims the provider slot, so the only state it owns is the registration it releases with the fiber; a companion would restate that lifecycle rather than test it.
