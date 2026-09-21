---
description: "Step-count benchmark for computer-use tasks: measures how many calls this stack needs and pairs it with the recorded cost of the vision path."
kind: "package-reference"
---

# @aeven/computer-use-benchmark

English | [中文](README.zh.md)

## Summary

The goal this stack exists for is "fewest steps", and until that is measured it is an opinion. This produces the number.

Two kinds of evidence are kept strictly apart, because merging them would be the easiest way to overstate the result:

- **`measured`** — the task ran here, and the count is taken at the mechanism seam rather than trusted to a handler's own report. That is a count, not an estimate.
- **`recorded`** — the vision-path baseline was observed in an earlier session and is carried as a labelled constant. It is reported as `recorded`, never as `measured`, because this package cannot reproduce it without driving a real desktop through the failing path.

Tasks that cannot run on this host are reported as **skipped with the reason**, never omitted. A benchmark that quietly drops what it could not reach would overstate everything it kept — and the tasks it cannot reach are exactly the ones whose adapters are still unverified.

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
import { runBenchmark, renderBenchmark } from '@aeven/computer-use-benchmark'
import { STARTER_BOOK } from '@aeven/computer-use-router'

const report = await runBenchmark({
  book: STARTER_BOOK,
  tasks: [
    { task: 'file.exists', platform: 'darwin', parameters: { path: '/tmp' } },
    { task: 'document.createText', platform: 'darwin', app: 'com.apple.Pages', parameters: { path: '/Users/me/Desktop/story.pages', text: 'x' } },
    { task: 'spreadsheet.setCell', platform: 'win32', parameters: { cell: 'A1', value: '1' }, skip: 'no Windows host' },
  ],
})

console.log(renderBenchmark(report))
```

Current output on macOS:

```text
task                          platform   calls  baseline   evidence
----------------------------  ---------  -----  ---------  ----------------------
file.exists                   darwin         1         -   measured / recorded
document.createText           darwin         1  recorded 20 measured / recorded
mail.listAccounts             darwin         1         -   measured / recorded
calendar.list                 darwin         1         -   measured / recorded
spreadsheet.setCell           win32          -         -   skipped: no Windows host available

measured total: 4 call(s) across 4 task(s)
skipped: 1 task(s), each with its reason above
document.createText: 20 recorded vs 1 measured = 20x fewer steps
```

## Understand the implementation

### The count is taken at the seam

`measureTask` wraps the handler for the mechanism the task resolves to and counts invocations, so the figure is the calls the stack actually issued through the session, router, executor, and handler chain. A handler reporting how much it did is not evidence of how many steps were taken.

### A skipped task is a result

`measureTask` reports `skipped` with the failure when resolution or execution fails, rather than a zero. Zero would read as "free", which is the opposite of "we could not find out".

### Ratios need both figures

`stepRatio` returns `undefined` when either figure is missing, and refuses to divide by zero rather than reporting infinity. A ratio is only printed for a task that has both a measurement and a recorded baseline.

## Further Exploration

- [`@aeven/computer-use-session`](../computer-use-session/README.md) — the batching surface the measurement runs through.
- [`@aeven/computer-use-router`](../computer-use-router/README.md) — the recipes and their evidence tags.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **One recorded baseline.** Only `document.createText` has a vision-path figure, because it is the only task measured the other way. Every other ratio is unavailable rather than assumed.
- **The mechanism is stubbed during measurement.** The count reflects the stack's call count; whether Pages was installed on the measuring host is a separate question, which is why the real end-to-end run lives in the handler's suite.
- **Only the macOS tasks run here.** Windows and Linux tasks are skipped with a reason until a host exists.
- **No CI gate yet.** The report is produced on demand; nothing fails a build when a step count regresses.
- **Steps counted are mechanism invocations**, not model turns. The model-turn figure depends on the session surface, which is not wired to a tool yet.

<a id="dev-note"></a>
## Dev Note

The benchmark deliberately cannot flatter itself. Its most useful property is not the 20× ratio but the "skipped, with reason" line: the two platforms it cannot reach are the two whose adapters are least verified, and a benchmark that omitted them would report a cleaner number for less coverage.

The baseline constant is labelled `recorded` rather than `measured` because this package cannot reproduce it. That distinction is the whole reason the evidence field exists: a reader can tell which number came from a run and which came from earlier work.

**Runtime invariant:** No companion is published because The package counts mechanism invocations while measuring and reports the count in its result, so the number a companion would assert is the number already returned.
