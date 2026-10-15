---
description: "COM mechanism handler for Windows computer use: drives the running Office application through PowerShell, and reports what it observed."
kind: "package-reference"
---

# @aeven/computer-use-windows-com

English | [中文](README.zh.md)

## Summary

The Windows **semantic** mechanism, registered with [`@aeven/computer-use-executor`](../computer-use-executor/README.md). It performs a recipe's operation against an Office application's automation model through PowerShell and reports what it observed.

It exists because the semantic rung is where the payoff is on this platform: setting a cell is one COM member call, where the same work through the ribbon is a sequence of clicks, keystrokes, and dialogs. The `spreadsheet.*`, `document.*`, `slide.*`, and `presentation.*` recipes resolve here when the host is `win32`.

Three things it deliberately does not do. It does not treat its own output as a verdict — a handler reports, the executor decides by re-reading an independent observable. It does not launch the application: every operation in the book is written against the running instance, so the handler attaches and refuses by name when there is nothing to attach to. And it does not attempt an operation it does not implement, because a recipe naming an operation nothing performs is a bug worth surfacing.

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
import { createComHandler, type ComRunner } from '@aeven/computer-use-windows-com'

declare const runner: ComRunner

const executor = new TaskExecutor({
  book: STARTER_BOOK,
  handlers: { com: createComHandler({ runner }) },
})

await executor.executeOrThrow({
  task: 'spreadsheet.setCell',
  platform: 'win32',
  app: 'Excel.Application',
  parameters: { sheet: 'Sheet1', cell: 'A1', value: '42', path: 'C:\Users\me\Desktop\book.xlsx' },
})
```

The runner is injected, so the handler needs no process access of its own and every failure mode is testable. Supply one that runs the script with PowerShell 7 (`pwsh`) or Windows PowerShell, resolving the executable the way [`@aeven/computer-use-windows`](../computer-use-windows/README.md) does.

| Application | Document the operation acts on | Member that saves it |
|---|---|---|
| `Excel.Application` | `ActiveWorkbook` | `SaveAs2` |
| `Word.Application` | `ActiveDocument` | `SaveAs2` |
| `PowerPoint.Application` | `ActivePresentation` | `SaveAs` |

## Understand the implementation

### It attaches to a running application instead of starting one

The book's Windows operations name `ActiveDocument`, `Selection`, and `Presentations`, which only exist on a live instance with a document open, so the generated program calls `GetActiveObject` and throws a named error when PowerShell cannot attach. This also sidesteps PowerPoint's refusal to run hidden, which starting the application with `New-Object` would have to satisfy before any operation could run.

### Values are embedded as literals, never interpolated

Program text is generated from caller-supplied values, so every value goes through a PowerShell single-quoted literal with doubled quotes. That is the one PowerShell string form that performs no interpolation: `$name`, backticks, and `"` stay literal, so a cell containing `$(Remove-Item …)` is written as text rather than evaluated.

### The wrapper saves when the operation does not

A recipe's verification reads an independent observable, and every Office recipe verifies the file, so the wrapper saves the document to the caller's `path` through the host's own member — except for `SaveAs2`, `SaveAs`, and `ExportAsFixedFormat`, which are the save. An operation with no `path` saves nothing and leaves the document modified.

### Failures carry PowerShell's own words

A non-zero exit reports `stderr` verbatim, and a failure that explained nothing says so rather than producing an empty message. A missing parameter and an unknown application are both refused before any program runs.

## Further Exploration

- [`@aeven/computer-use-executor`](../computer-use-executor/README.md) — the executor this handler registers with, and the verification it does not do itself.
- [`@aeven/computer-use-router`](../computer-use-router/README.md) — the recipes whose operations this handler implements.
- [`@aeven/computer-use-windows-provider`](../computer-use-windows-provider/README.md) — the composition that mounts this handler with the Windows adapter.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No operation here has been run against a live Excel, Word, or PowerPoint.** The book marks these recipes `documented`, and this handler does not claim more: its tests assert the generated program and the dispatch behaviour against a recording runner. What is still unverified on a Windows host with Office installed is whether each operation's member call is accepted, and whether the verification that follows it reads back what the operation wrote.
- **`Presentations(item)` resolves to the active presentation.** The book's parameter list for that operation names no item index, so the wrapper addresses `ActivePresentation` rather than inventing an index.
- **`Shapes.AddChart2` passes `-1` as the style.** The book's chart parameters name a chart type but no style, and style is the operand the member requires.
- **One application per call.** A batch that spans Excel and Word runs two calls, because a recipe binds one application.
- **No timeout of its own.** A member call that blocks — Office's own busy or message-filter behaviour is the common cause — is the runner's problem to bound.
- **No read-back of the written value.** The handler reports the wrapper's own JSON, and the executor's verification decides; a caller that needs the cell's contents asks for them through the adapter or a connector.

<a id="dev-note"></a>
## Dev Note

The host application comes from the request's `app`, which the router fills from the recipe's `apps` entry, so the three automation identifiers are the only accepted values and a fourth is refused by name rather than guessed.

The path a caller passes is the same value the recipe's `fileExists` expectation resolves, which is why the wrapper saves through the document member instead of leaving the caller to do it: a task whose verification cannot pass because nothing saved would be a task that always fails.

**Runtime invariant:** No companion is published because the package builds program text and returns its streams; the only ordering is one call to one runner, which the caller already awaits.
