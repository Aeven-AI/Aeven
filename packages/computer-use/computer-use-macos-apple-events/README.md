---
description: "Apple Events mechanism handler for macOS computer use: runs the measured one-call document path, Mail and Calendar recipes through osascript."
kind: "package-reference"
---

# @aeven/computer-use-macos-apple-events

English | [中文](README.zh.md)

## Summary

The macOS **semantic** mechanism, registered with [`@aeven/computer-use-executor`](../computer-use-executor/README.md). It runs a recipe's operation through `osascript` and reports what it observed.

It exists because this is the one mechanism whose payoff is measured rather than assumed: creating a Pages document containing text is **one call** this way, against more than twenty through the accessibility tree that failed to complete the same task. Pages, Mail, and Calendar recipes resolve here.

Two things it deliberately does not do. It does not treat its own output as a verdict — a handler reports, the executor decides by re-reading an independent observable. And it does not attempt what a recipe declares blind: an operation the scripting bridge cannot perform is resolved to another rung before it reaches this handler.

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
import { TaskExecutor } from '@aeven/computer-use-executor'
import { STARTER_BOOK } from '@aeven/computer-use-router'
import { createAppleEventsHandler } from '@aeven/computer-use-macos-apple-events'

const executor = new TaskExecutor({
  book: STARTER_BOOK,
  handlers: { 'apple-events': createAppleEventsHandler({ runner }) },
})

await executor.executeOrThrow({
  task: 'document.createText',
  platform: 'darwin',
  app: 'com.apple.Pages',
  parameters: { path: '/Users/me/Desktop/story.pages', text: 'The Cartographer of Small Hours' },
})
```

The runner is injected, so the handler needs no process access of its own and every failure mode is testable. Supply one that shells out to `osascript -l JavaScript`.

## Understand the implementation

### Values are embedded as literals, never interpolated

Script text is generated from caller-supplied values, so `JSON.stringify` is used rather than hand-rolled escaping. It produces a valid JavaScript string literal for every input — quotes, backslashes, newlines, non-BMP characters — so a document containing a quote cannot break out of the literal it was pasted into.

### One call, and it reads itself back

The document operation creates, writes, saves, and reads the body text in a single script. That is the measurement the layered design rests on, so it is preserved as one call rather than decomposed.

### Failures carry the application's own words

A non-zero exit reports `stderr` verbatim, and a failure that explained nothing says so rather than producing an empty message. An unrecognised operation is refused before any script runs, because a recipe naming an operation nothing implements is a bug worth surfacing.

## Further Exploration

- [`@aeven/computer-use-executor`](../computer-use-executor/README.md) — the executor this handler registers with, and the verification it does not do itself.
- [`@aeven/computer-use-router`](../computer-use-router/README.md) — the recipes whose operations this handler implements.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **The verified operations are the measured ones.** Document creation, Mail accounts and inbox subjects, and Calendar listing. Other operations refuse rather than guess.
- **Only the current frontmost application is scripted.** Multi-window Pages documents are addressed by the application, not a specific window.
- **Automation is granted per target application**, so each newly scripted application costs one consent dialog the first time.
- **A spawned helper holds its own grant.** `osascript` cannot use Æven's Accessibility grant, and the Apple Events entitlement belongs to whichever binary sends the events. A native helper sending events through ScriptingBridge is what collapses that to a single principal.
- **No timeout of its own.** A script that hangs is the runner's problem to bound.

<a id="dev-note"></a>
## Dev Note

The end-to-end path was run for real before being committed: recipe → router → executor → this handler → verification, producing a 92,896-byte Pages document that Pages then read back as exactly `The Cartographer of Small Hours`, 31 characters, with both expectations satisfied from disk.

The hostile-literal test is not decoration. Generated script source with caller-supplied text is a place where a quote in a document could become executable code, and `JSON.stringify` is the specific defence that makes it impossible rather than unlikely.

**Runtime invariant:** No companion is published because The package builds script text and runs it, returning the streams, so the only ordering is one call to one runner, which the caller already awaits.
