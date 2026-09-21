---
description: "Recipe routing for computer use: which layer performs a task, on which platform, in which application, and what must be independently true afterwards."
kind: "package-reference"
---

# @aeven/computer-use-router

English | [中文](README.zh.md)

## Summary

Decides **which layer performs a task** — the semantic application API, the accessibility tree, or vision — and refuses rather than guessing.

The knowledge lives in recipes, which are data: for one task on one application, a recipe declares the rung, the mechanism, the operation, the applications it covers, what must be independently true afterwards, and **what that mechanism cannot do**. The router contains no per-application logic, so "which layer wins here" is reviewable in one place instead of scattered through conditionals.

Three rules shape resolution, each from a measured failure:

- **Prefer the highest rung available.** Choosing the semantic layer over vision was the difference between one call and more than twenty on the same task.
- **Never silently degrade.** The ladder is descended only where a recipe declares a lower rung, or when the host reports the better rung unavailable — never quietly, because a silent fall is indistinguishable from success until the result is wrong.
- **Never invent coverage.** An unknown task, platform, or application produces a refusal that lists what was searched.

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
import { RecipeRouter, STARTER_BOOK } from '@aeven/computer-use-router'

const router = new RecipeRouter(STARTER_BOOK)
const resolved = router.resolve({ task: 'document.createText', platform: 'darwin', app: 'com.apple.Pages' })

resolved.rung        // 'semantic' — take the cheapest layer that works
resolved.invocation  // { mechanism: 'apple-events', operation: 'Document().make(); …' }
resolved.knownBlind  // ['document.applyFont', 'template.choose']
resolved.verify      // expectations to check independently after it runs
```

Pass `availableRungs` from a desktop adapter's readiness report to keep resolution honest about what this host can actually do:

```ts
router.resolve({ task: 'document.setFont', platform: 'darwin', availableRungs: ['vision'] })
```

## Understand the implementation

### The ladder, and why order matters

`RUNG_ORDER` is semantic, then accessibility, then vision. Resolution walks it and takes the first rung a recipe offers that the host can use. A tie at the same rung is broken by the recipe's own order, so a recipe can express a preference without inventing a new rung.

### `knownBlind` is not decoration

It carries as much weight as `rung`. It is what stops the router discovering a blind spot in front of a user. The Pages recipes show why: content is reachable in one Apple Events call, but the scripting bridge does not reach paragraph or font attributes at all — so `document.applyFont` is declared blind on the semantic entry and resolved to the accessibility rung instead of being attempted and failing.

### Evidence is tagged, and the tags are not equivalent

Every invocation is marked `verified` (run on this machine and read back) or `documented` (from a published API, not run here). A consumer must not present them as the same thing. The macOS Pages, Mail, and Calendar entries are verified; the Windows COM and Linux UNO entries are documented only.

### Refusals list what was searched

An unknown task reports the tasks the book knows. A platform with no recipe reports the platforms that task does cover. An uncovered application reports the applications it does cover. Coverage lists are deduplicated, so a platform with several invocations is named once.

## Further Exploration

- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.md) — the contract whose expectations a recipe's `verify` uses.
- [`@aeven/computer-use-macos`](../computer-use-macos/README.md), [`@aeven/computer-use-windows`](../computer-use-windows/README.md), and [`@aeven/computer-use-linux`](../computer-use-linux/README.md) — the adapters the rungs resolve to.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **The router selects; it does not execute.** A resolved invocation names a mechanism and an operation, and the consumer that owns that mechanism runs it. No executor is wired up yet.
- **The book is a starter set**, covering filesystem tasks, Pages, Mail, Calendar, and Office spreadsheets, documents, and slides. Everything else refuses.
- **Windows and Linux entries are unverified.** COM and UNO are stable and well documented, but nothing here has driven either, so their `evidence` is `documented`.
- **No rung downgrade graph.** A recipe lists the rungs it offers; it cannot yet express "try accessibility, and if the element is absent fall to vision". That needs per-task conditional logic the data model does not have.
- **Expectation placeholders are not substituted.** Recipes use `{path}`-style parameters, and filling them in is the consumer's job.

<a id="dev-note"></a>
## Dev Note

The recipes carry the measurements the rest of this stack is built on, which is why they live in a package rather than in documentation: a Pages content write is one call and reads back byte-exact, the Pages scripting bridge loses paragraph handling entirely, and Mail needs unread read per mailbox because the application-wide call throws. Those facts are testable as data, and the tests assert them.

The refusal messages were deduplicated after the tests caught a platform repeated once per invocation. The failure output was worth reading rather than loosening the assertion.
