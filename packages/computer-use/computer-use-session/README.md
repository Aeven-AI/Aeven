---
description: "Batched computer-use session over a desktop adapter: many steps per call, and tree changes reported as a delta instead of a whole tree."
kind: "package-reference"
---

# @aeven/computer-use-session

English | [中文](README.zh.md)

## Summary

The surface where the largest step saving lives, and it is not in the adapters.

A reference implementation exposes computer use as **one code tool over a session** rather than one tool per action, and its own guidance is to batch related inputs because a state capture is expensive. This package is that session: `run()` takes many steps and returns one result, so N actions cost one round trip instead of N.

It also remembers the last observation, so a repeated look reports a **delta** rather than re-sending a whole tree — a document window can publish hundreds of nodes and almost all of them are unchanged. And it carries verification into the batch, so "did it work" is part of the result rather than a separate call.

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
import { ComputerUseSession } from '@aeven/computer-use-session'
import { STARTER_BOOK } from '@aeven/computer-use-router'
import type { DesktopAdapter } from '@aeven/computer-use-desktop'
import type { MechanismHandler } from '@aeven/computer-use-executor'

// Supplied by the caller: the adapter to observe through, and handlers for the
// mechanisms this stack does not implement.
declare const adapter: DesktopAdapter
declare const handlers: Readonly<Record<string, MechanismHandler>>

const path = '/Users/me/Desktop/story.pages'
const text = 'The Cartographer of Small Hours'

const session = new ComputerUseSession({ book: STARTER_BOOK, adapter, handlers })

const batch = await session.run([
  { kind: 'execute', request: { task: 'document.createText', platform: 'darwin', app: 'com.apple.Pages', parameters: { path, text } } },
  { kind: 'observe' },
  { kind: 'readiness' },
])

batch.verified  // every executed task verified, so the batch is trustworthy
batch.results   // one entry per step, tagged by kind
```

## Understand the implementation

### One call, many steps

`run()` performs its steps in order and **stops at the first failure**. A later step in a batch almost always depends on an earlier one having succeeded, so continuing would act on an interface that never reached the expected state.

### A delta is only meaningful about the same thing

The diff compares by **position**, not by token. A token embeds its snapshot id, so comparing tokens across two observations would report every node as simultaneously removed and added — a delta that says nothing while looking busy.

Positions are compared only when both observations cover the same windows; a different window is a different walk, so that case reports a complete tree. The diff says which it is via `complete`, so a caller never has to infer "everything is new" from the contents.

### Unchanged nodes are reported as positions

There is nothing to act on in an unchanged node, and it would carry a token the caller already has. The diff reports those as indices, while a **changed** node carries its current token, which is the one an action must use now.

## Further Exploration

- [`@aeven/computer-use-executor`](../computer-use-executor/README.md) — what `execute` steps run through.
- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.md) — the adapter contract this session observes and verifies through.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Not wired to a model-facing tool yet.** This is the session object a consumer would expose; nothing registers it as a `run_code`-style binding or a model tool.
- **No persistent kernel.** The session lives in the host process, which is what lets a batch share state while the code runtime stays stateless and reconstructable from the log.
- **No wait policy.** `isQuiet(diff)` gives a caller the signal for polling until an interface settles, but nothing waits for it automatically.
- **Steps are not resumable.** A batch that stops at a failed step reports what it did and returns; re-running it repeats the steps that already succeeded.
- **No desktop exclusivity**, deliberately: a session is the caller's context, not a claim on the machine.

<a id="dev-note"></a>
## Dev Note

The first diff implementation compared by token and was wrong in a way that looked right: the tests failed because every re-observation reported the entire tree as new. That is exactly the kind of bug that ships silently — the delta is non-empty, plausibly shaped, and useless. Comparing by position fixed it, and a different-window check keeps positions from being compared across unrelated walks.

`isQuiet` exists because an empty delta is a cheaper and more reliable readiness signal than a fixed sleep, which is what the measured runs spent most of their wall-clock on.

**Runtime invariant:** No companion is published because The package batches steps and diffs observations as returned values, and a caller awaits each batch, so the ordering is carried by the await rather than by an event a listener would have to reassemble.
