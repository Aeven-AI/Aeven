---
description: "Performs a resolved recipe through its mechanism and establishes that the task actually worked, rather than trusting what the handler reported."
kind: "package-reference"
---

# @aeven/computer-use-executor

English | [中文](README.zh.md)

## Summary

Performs a task and then establishes that it worked.

It fills the gap the router leaves. [`@aeven/computer-use-router`](../computer-use-router/README.md) resolves *what* should happen; this package resolves the task, hands the invocation to whichever handler owns that mechanism, and verifies the result **independently**.

The order is the whole point. The handler runs, and its own report is treated as **advisory only** — the verdict comes from re-reading observables. Measured experience is blunt about why: an action reported `delivered_count: 42` while the target file never changed, and a save reported success while writing nothing. So `executeOrThrow` throws `unverified` rather than returning a happy result, and a skipped verification is reported as `verified: false`, because *not checked* is not *passed*.

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
import { TaskExecutor, type MechanismHandler } from '@aeven/computer-use-executor'
import { STARTER_BOOK } from '@aeven/computer-use-router'

// Registered by a consumer: this package runs a mechanism, it does not implement one.
declare const runAppleEvents: MechanismHandler

const executor = new TaskExecutor({
  book: STARTER_BOOK,
  handlers: { 'apple-events': runAppleEvents },   // mechanisms this package does not own
})

const outcome = await executor.executeOrThrow({
  task: 'document.createText',
  platform: 'darwin',
  app: 'com.apple.Pages',
  parameters: { text: 'the story', path: '/Users/me/Desktop/story.pages' },
})

outcome.verified   // true only because the file was re-read from disk
outcome.outcomes   // one result per expectation, with what was actually observed
```

## Understand the implementation

### One mechanism is built in; the rest are registered

This package implements the **filesystem** and nothing else, deliberately. The filesystem is identical on every platform and needs no application, no permission grant, and no UI, which makes it both the cheapest rung and the one that can be tested without a live desktop.

Every other mechanism — Apple Events, COM, D-Bus, the accessibility trees — arrives as a handler registered by a consumer. That is the boundary, not a gap: the executor decides *when* to run something and *whether it worked*, while the consumer decides *how*, because only it knows which applications are installed on which host. A mechanism with no handler is a capability failure naming the mechanism, never a silent no-op.

### Report advisory, verdict independent

`MechanismResult.observed` is carried into the outcome for the caller to see, and is never used to decide whether the task succeeded. The verdict comes from `verify()`, run against the resolved expectations.

### Parameters resolve the checks too

A recipe is written once and used for many calls, so its expectations contain placeholders — `{path}`, `{text}`. The same value map fills both the invocation and its checks, so a verification reads the path the task actually wrote.

An unfilled placeholder is an **error, not a wildcard**. Resolving it to an empty string would produce a check that passes on almost anything, and a verification that cannot fail is worse than none because it reports success.

## Further Exploration

- [`@aeven/computer-use-router`](../computer-use-router/README.md) — the resolution this package executes.
- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.md) — the verifier and the adapter contract used for observables the filesystem cannot answer.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No non-filesystem handler ships.** Apple Events, COM, and D-Bus handlers must be registered by a consumer; until they are, tasks using those mechanisms refuse.
- **No retry or wait policy.** A task that needs a moment to settle — a save dialog closing, a document being written — has no event-driven wait here yet, so a caller must poll or wait itself.
- **Expectations are resolved but not type-checked against the operation.** A recipe could declare a `fileEquals` check for a task whose operation never writes that file; nothing detects the mismatch before the check fails.
- **No execution log.** Outcomes are returned, not persisted, so a batched session has no record beyond what the caller keeps.

<a id="dev-note"></a>
## Dev Note

The tests run the filesystem mechanism against the **real** filesystem rather than a mock, because a mocked write proves nothing about whether a write lands. The most valuable test in the suite is the one whose handler reports success while writing something else — it is the shape of the failure that motivated this package, and it asserts that the verdict comes out false even though the handler was happy.

A test that supplied an adapter for verification originally passed a path that did not exist, so the handler failed before verification ever ran. It was rewritten to write a real file first: a verification test that passes because the step before it threw is not testing verification.

**Runtime invariant:** No companion is published because The package runs one task and then verifies it by re-reading an independent observable, which is a sequencing the caller already awaits, so publishing a companion sequence would restate the return value.
