---
description: "File-format recipes: produce and read documents, workbooks, presentations and PDFs without launching an application."
kind: "package-reference"
---

# @aeven/computer-use-formats

English | [中文](README.zh.md)

## Summary

Recipes that produce and read **files**, never a running application. That is what makes them the winning source wherever a file is the deliverable: no Office installation, no running process, no permission grant, and verification by reading the result back.

The approach is taken from the document skills Anthropic ships with its desktop application — `docx`, `xlsx`, `pptx`, `pdf` and `pdf-reading` — which are the only source that covers these operations at all. They independently arrived at this stack's verification rule too: their spreadsheet skill makes recalculation mandatory and warns that a clean exit code is not a clean file, because a run reporting errors still exits zero.

**These recipes need tools this machine does not have.** Measured here: `soffice` is ready, and `pandoc`, `openpyxl`, `python-docx`, `python-pptx`, `pdfplumber` and `markitdown` are all blocked — **6 of 7**. So every recipe carries a readiness requirement, and `missingTools()` refuses a task *before* it runs, naming the tool and its remedy.

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
import { probeFormatReadiness, missingTools, FORMAT_RECIPES } from '@aeven/computer-use-formats'

const report = await probeFormatReadiness(runner)
// format.soffice       ready
// format.pandoc        blocked
// format.openpyxl      blocked
// …

missingTools('spreadsheet.createWorkbook', report)  // ['soffice', 'openpyxl']
```

The report is a `ReadinessReport`, so it composes with the adapter contract's shape and each missing tool carries its own remedy.

## Understand the implementation

### The format layer and the application layer are kept side by side

They are **not overlapping**. One produces a file; the other changes what the user has *open*. A file deliverable is cheaper through this layer — no installed Office, no running process, no grant, and the result is verifiable by reading it back. A live, unsaved document is only reachable through the application layer. The deciding question is about the deliverable, and it belongs in the router as a rung of its own.

### Requirements are derived, not listed twice

`requiredTools()` reads the tools out of each recipe's own operation text rather than from a parallel list that could drift from it. `spreadsheet.createWorkbook` resolves to `['soffice', 'openpyxl']` because its operation says so.

### Recalculation is mandatory, and the blind spot says why

`openpyxl` stores formulas as strings with **no cached values**, so until a workbook is recalculated every formula cell reads back as absent to anything reading cached values — `pandas`, `load_workbook(data_only=True)`, and most previewers. The recipe therefore declares `spreadsheet.writeWithoutRecalculating` blind and runs `soffice --headless` over the result.

### Only one conversion is asserted by content

A PDF is checkable by its own bytes, so `document.convertToPdf` asserts `%PDF`. The others assert the **container part name** — `xl/workbook.xml`, `word/document.xml` — because an OOXML file is a zip and a text search of its bytes would pass for the wrong reason. A test enforces that no empty-string check ships, since a check that cannot fail is worse than none.

## Further Exploration

- [`@aeven/computer-use-router`](../computer-use-router/README.md) — the application-operation recipes this layer complements.
- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.md) — the readiness and verification shapes this uses.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Six of the seven tools are blocked on this machine**, so most of these recipes cannot run here yet. The readiness report names each one and its remedy; nothing fails at the point of use.
- **No executor wiring.** These are `filesystem`-mechanism recipes, and the executor's built-in filesystem handler implements `readFile`, `stat` and `writeFile` only — so it refuses these operations. A format handler is not written yet.
- **Layout is absent by design.** Codex's slide-layout catalog wins the layout capability, and it is not reimplemented here.
- **No OCR.** `pdf.extractText` reads the text layer and declares `pdf.ocrScannedPages` blind; a scanned page needs rasterization and an OCR tool neither this layer nor the machine has.
- **`presentation.readText` is read-only.** Creating presentations from layouts belongs to the layout rung, not here.

<a id="dev-note"></a>
## Dev Note

The `PlatformInvocation` type prohibits a top-level `mechanism` field, and it earned its place here: adding eighteen recipes produced eighteen type errors in one pass, each pointing at the redundant field, instead of eighteen silent duplications that a reviewer would have had to notice.

The readiness probe is the part worth keeping even when the tools are missing. A recipe that failed inside a task with "command not found" would be exactly the illegible failure this stack exists to eliminate; instead the report says `format.pdfplumber` is blocked and what installs it.

**Runtime invariant:** No companion is published because The package declares file-format recipes and reports which tools are present, both as returned data, so there is no effect ordering for a listener to assert.
