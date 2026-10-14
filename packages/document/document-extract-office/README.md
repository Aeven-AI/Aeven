---
description: "The Office document reader backed by the bundled LibreOffice engine: legacy Word, Excel, and PowerPoint, plus Office files the built-in readers cannot read."
kind: "package-reference"
---

# @aeven/document-extract-office

English | [中文](README.zh.md)

## Summary

`avn-document-extract-office` registers the provider `office` at priority 10 on `ctx.documentExtract`, so it runs after the built-in readers and reads what they cannot: legacy Word, Excel, and PowerPoint files, and Office files whose built-in read returned no text. Word-processing formats are exported as UTF-8 text and spreadsheets and presentations as PDF, which is handed back to the registry's PDF readers. The engine is the LibreOffice build that `@deepseek-ai/libreoffice-kit` installs for the host platform; each conversion runs in an engine process with the document in a private temporary directory, and plugin load rejects when that engine is missing from the installation.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount it beside the service: the plugin registers the `office` provider on `ctx.documentExtract`.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `timeoutMs` | `120000` | Wall-clock limit of one conversion, measured from when it leaves the queue |
| `concurrency` | `1` | Simultaneous conversions; each runs its own engine process |

<a id="model-experience"></a>
## Model Experience

### Extracted document text

#### What the model sees

This package registers no prompt, tool, or session event, and returns a `method: "office"` result. The text it returns through `ctx.documentExtract` is stored as the uploaded file's text by the consumer that accepted the upload, so a model reads it as that file's content; text exported by the engine keeps the document's paragraph breaks, with runs of blank lines collapsed.

#### Token effect

Bounded per document by the registry's `maxTextChars`; the PDF a spreadsheet or presentation converts to is read by another provider under the same budget.

#### KV Cache effect

Append-only: the text enters the request with the message that carries the uploaded file.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A host without the platform engine fails to mount** — `apply` awaits the engine factory, so the plugin reports a load failure instead of degrading to the other readers; the kit ships the engine as an ordinary dependency, so nothing is downloaded at runtime.
- **One engine process per conversion** — the conversion writes an input file and reads an output file in a private temporary directory, so `concurrency` above 1 multiplies engine processes and temporary directories.
- **No invariant companion** — No runtime invariant companion is published because every conversion happens in a separate engine process and returns through files in that temporary directory, so the package owns no same-process relation; its one durable relation is the engine factory's disposal, registered as a single `ctx.effect`, and the provider's behavior is asserted in `tests/office.spec.ts`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
