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

That distinction is load-bearing for the Office set specifically. It is the largest group of recipes here and the one most likely to be trusted without checking, which is exactly why every entry carries `documented` and a test asserts that none of them claims otherwise.

### The common-application set was curated from public task sets

Those recipes were not invented; each traces to a **named end-state check** in a public benchmark, which is what makes a real assertion possible. `calendar_check_weekly_event_advanced` names an event, a time and a weekday; `new_apple_notes_check_note_exists_in_folder` names a note and its folder; `clock_check_clock_timer_value` names a timer. So `calendar.createEvent` verifies a `calendarHasEvent`, `notes.createNote` verifies a `noteExists`, and `clock.createAlarm` verifies an `appObject` in the alarm collection.

Two boundaries are stated rather than hidden, and the tests enforce that neither is a convenience:

- **Calculator publishes no scripting dictionary**, so its display cannot be read programmatically. The recipe computes the expression exactly through the standard library and declares `calculator.readDisplay` blind, because a recipe that claimed to read a display it cannot read would be worse than one that admits the gap — a caller would trust the answer.
- **A Pages document is a package**, so its body text cannot be asserted by searching the container. That recipe checks the written bytes and leaves the semantic read-back to the consumer.

A test also refuses any check that would pass for almost anything: no empty-string substring assertion ships, because a verification that cannot fail is worse than none.

### The Pages template step is explicit because the sources revealed it

Benchmark instructions for Pages are specific: *"Create a new document using the template 'Blank Black' and name it …"*. That resolves a problem measured directly on this machine, where the Creator Studio template chooser exposes two accessibility elements and document creation treated as a single call never gets past it. `document.createFromTemplate` takes the template as a parameter, so the step is named instead of being a surprise.

### A sibling package covers the file layer

`@aeven/computer-use-formats` holds the recipes whose deliverable is a file —
spreadsheets, documents, presentations, PDFs — which need no application at all. They
are declared `file`; every recipe in this book is `open-application`, and a test
asserts both.

### Office and LibreOffice are semantic on purpose

A cell write is one COM member call on Windows and one UNO call on Linux, where the same operation through the ribbon is a sequence of clicks, keystrokes, and dialogs. The task vocabulary was cross-checked against `microsoft/cua_skill`'s per-application action modules, which enumerate the same operations from the UI side — but the recipes here implement them through the application's own API rather than by composing UI steps, because that is where the step saving is.

The one exception is macOS formatting: the Pages scripting bridge cannot reach paragraph or font attributes at all, so `document.setFont` resolves to the accessibility rung there and says so in `knownBlind`.

### The deliverable decides between two otherwise equal layers

A recipe can state what it must affect: a **file** on disk, or the state of an
**open application**. This is not a rung — a rung says *how* work is done, this says
*what the work must affect*, and it settles the one case where two layers look equally
plausible.

The file layer needs nothing installed, nothing running, and no permission grant,
works identically on every platform, and verifies by reading the result back. The
application layer is the only one that can reach a user's **unsaved** edits, because a
file-level tool cannot see them at all.

Passing `deliverable` filters to recipes that agree, so a caller needing a live
document is never handed a file-level recipe and a caller wanting a verifiable file is
never handed one that would need Office installed. Omitting it **skips the check
rather than assuming a default**, and a recipe that never states its deliverable is
refused when a caller requires one — because guessing there is exactly the decision
the caller was asking to make.

### Refusals list what was searched

An unknown task reports the tasks the book knows. A platform with no recipe reports the platforms that task does cover. An uncovered application reports the applications it does cover. Coverage lists are deduplicated, so a platform with several invocations is named once.

## Further Exploration

- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.md) — the contract whose expectations a recipe's `verify` uses.
- [`@aeven/computer-use-macos`](../computer-use-macos/README.md), [`@aeven/computer-use-windows`](../computer-use-windows/README.md), and [`@aeven/computer-use-linux`](../computer-use-linux/README.md) — the adapters the rungs resolve to.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **The router selects; it does not execute.** A resolved invocation names a mechanism and an operation, and the consumer that owns that mechanism runs it. No executor is wired up yet.
- **The book is a starter set** — 32 tasks: filesystem work, Pages, Mail and Calendar; 13 Office and LibreOffice tasks covering Excel, Word, PowerPoint, Calc, Writer and Impress; and 12 curated common-application tasks for Calculator, Clock, Calendar, Notes and Pages. Everything else refuses.
- **Windows and Linux entries are unverified.** COM and UNO are stable and well documented and the operations are their canonical entry points, but nothing here has driven a live Office or LibreOffice, so their `evidence` is `documented`. Verifying them on real hosts is deliberately deferred to a later stage rather than being claimed now.
- **Office-task verification is deliberately coarse.** OOXML and ODF are containers, so a text search of their bytes would pass for the wrong reason; those recipes assert that the file was written and leave content checking to the consumer's own semantic read-back. Only the PDF exports assert content, because a PDF is checkable by its own bytes.
- **No Office or LibreOffice mechanism handler ships.** These recipes resolve to `com` and `dbus`, and the executor refuses a mechanism it has no handler for, so running one currently needs a consumer to register that handler.
- **No rung downgrade graph.** A recipe lists the rungs it offers; it cannot yet express "try accessibility, and if the element is absent fall to vision". That needs per-task conditional logic the data model does not have.
- **Expectation placeholders are not substituted.** Recipes use `{path}`-style parameters, and filling them in is the consumer's job.

<a id="dev-note"></a>
## Dev Note

The recipes carry the measurements the rest of this stack is built on, which is why they live in a package rather than in documentation: a Pages content write is one call and reads back byte-exact, the Pages scripting bridge loses paragraph handling entirely, and Mail needs unread read per mailbox because the application-wide call throws. Those facts are testable as data, and the tests assert them.

The refusal messages were deduplicated after the tests caught a platform repeated once per invocation. The failure output was worth reading rather than loosening the assertion.
