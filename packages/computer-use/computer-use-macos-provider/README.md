---
description: "The macOS computer-use provider for Æven: mounts the adapter, session, router and executor as one plugin and claims the exclusive registration slot."
kind: "package-reference"
---

# @aeven/computer-use-macos-provider

English | [中文](README.zh.md)

## Summary

The composition-facing half of macOS computer use. It assembles the adapter, session, recipe router, executor and Apple Events handler into one object, publishes it on the context, and claims the exclusive provider slot through [`@aeven/computer-use`](../computer-use/README.md).

It exists so that mounting macOS computer use is one row in a composition rather than five objects a deployment has to wire in the right order. The order matters: the seam is consulted **before** the provider is published, because a second provider must be refused with the name of the one already registered. The `package` returned by that seam is what makes the whole contribution reversible — unloading the plugin releases the slot again.

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
import * as computerUseMacosProvider from '@aeven/computer-use-macos-provider'

// In a composition, as one row:
//   '@aeven/computer-use': {}
//   '@aeven/computer-use-macos-provider': {}
```

`inject: ['computerUse']` is declared as `inject` on the plugin, so the row waits for the registry rather than failing when it is mounted first. A deployment staging a migration off the MCP wrapper can set `register: false`, which publishes the provider for its readiness reporting and session while leaving the slot free for another provider to drive.

`computer_use_run` accepts 1 to 20 `execute`, `observe`, or `readiness` steps. An execute step names a recipe task, optional application bundle id, and string parameters; the result includes per-expectation outcomes and `verified`. Each call owns a fresh session and forwards cancellation to host commands. Execution steps require write access and explicit approval; observation and readiness do not request execution approval. The Web bundle mounts semantic batches alongside the Cua Driver with `register: false`; the driver retains the exclusive registration and its accessibility and vision tools. The batch tool does not downgrade to those tools.

## Understand the implementation

### The seam decides duplicates, not the service store

The provider calls `ctx.computerUse.register(providerName)` **before** `ctx.provide('computerUseProvider', provider)`. Publishing first would let Cordis's own "service already registered" error win, which names the slot but not the owner, and names it in Cordis's vocabulary rather than this seam's. Ordering the calls this way makes the refusal say which provider is already there.

### `provide`, not `set`

A property has to be claimed before it can hold a value. `ctx.set` on an unclaimed name throws, and the disposer that `ctx.provide` returns is what releases the slot when the fiber unloads.

### Nothing is claimed that cannot be released

The provider owns no timers, no listeners and no processes of its own. Everything it publishes is disposed with the fiber, so a stop, update or undefine leaves no half-mounted provider behind.

## Further Exploration

- [`@aeven/computer-use`](../computer-use/README.md) — the exclusive slot this provider claims, and the seam that refuses duplicates.
- [`@aeven/computer-use-macos`](../computer-use-macos/README.md) — the accessibility and input adapter the provider publishes.
- [`@aeven/computer-use-macos-apple-events`](../computer-use-macos-apple-events/README.md) — the semantic mechanism, including the Keynote operations.
- [`@aeven/computer-use-executor`](../computer-use-executor/README.md) — the verification that decides whether a task actually succeeded.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Verified on macOS only.** The Windows and Linux adapters exist and are unit-tested, but no provider package mounts them yet and neither has been run on a real host.
- **Keynote is the only presentation application covered.** `slide.setText` resolves to it on macOS and was run live; every other `slide.*` and `presentation.*` task still targets Windows PowerPoint or Linux LibreOffice and has no macOS row.
- **A deck can be created and text set, but layout is not authored.** Writing into a layout placeholder works; adding a new text item does not, because Keynote refuses it on a slide.
- **Saving is constrained by Keynote's sandbox.** Keynote can only write inside its own container, so a deck is saved there and moved out afterwards. Asking it to write to an arbitrary path raises a modal that blocks the application.
- **The default recipe book is the starter book.** A deployment supplies its own through `recipes`.
- **Automation consent is per target application.** The readiness report only probes bundle ids a deployment names, because the first Apple Event to an application raises a consent dialog.

<a id="dev-note"></a>
## Dev Note

The Keynote path was run live before being committed: create a document, add a second slide, write text into a layout placeholder, save into Keynote's own container, read the text back through the application, then reopen the saved file and read it again from disk. Non-ASCII text — an em dash, an accented character and CJK — round-tripped unchanged, which is what ruled out the encoding theory for an earlier syntax error.

Three failures on that path were real and are now encoded as tests rather than left as comments. `make new slide` must be targeted at the document, because the untargeted form fails with `-10024 Can't make or move that element into that container`. A slide refuses a new text item, so text goes into a placeholder the layout provided. And `tell application "com.apple.Keynote"` is a syntax error, because that form takes a name; a bundle identifier needs AppleScript's `application id`.

An earlier version of this package called `ctx.set` before declaring the property, which surfaced as `cannot set property "computerUseProvider" without provide`. The registration tests caught it, which is why they assert on the *message* rather than merely on a throw.

**Runtime invariant:** No companion is published because The package assembles the other packages and claims the provider slot, so the only state it owns is the registration it releases with the fiber; a companion would restate that lifecycle rather than test it.
