---
description: "The built-in document reader: PDF, Office Open XML, OpenDocument, Pages, Keynote, Numbers, RTF, EPUB, HTML, and text, read in worker threads."
kind: "package-reference"
---

# @aeven/document-extract-js

English | [中文](README.zh.md)

## Summary

`avn-document-extract-js` registers the provider `js` at priority 0 on `ctx.documentExtract`, so it reads a document before the OCR and Office providers are asked. It covers PDF, Office Open XML, OpenDocument, iWork, RTF, EPUB, HTML, and text formats with JavaScript and WebAssembly libraries — the PDF readers ship in `vendor/` — and each document is read in its own worker thread with a wall-clock and heap limit, so nothing here needs a native binary and the provider ships inside the Desktop seed unchanged.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount it beside the service: the plugin registers the `js` provider on `ctx.documentExtract`.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `timeoutMs` | `60000` | Wall-clock limit for one document before its worker is terminated |
| `maxWorkerHeapMb` | `512` | Old-generation heap limit of one worker |
| `concurrency` | `2` | Simultaneous extraction workers |

<a id="model-experience"></a>
## Model Experience

### Extracted document text

#### What the model sees

This package registers no prompt, tool, or session event, and adds a `method: "native"` result. The text it returns through `ctx.documentExtract` is stored as the uploaded file's text by the consumer that accepted the upload, so a model reads it as that file's content; a PDF's text is its pages joined with blank lines, and an image-only PDF yields no text, which is why the registry falls through to the OCR provider.

#### Token effect

Bounded per document by the registry's `maxTextChars`; this package adds nothing beyond that text.

#### KV Cache effect

Append-only: the text enters the request with the message that carries the uploaded file.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Every document starts a worker** — the reader copies the bytes into the worker and pays a thread start per document, so many small uploads cost more than their text; `concurrency` bounds how many run at once.
- **PDF text comes from the layer the file carries** — a scanned PDF has none, which is why the OCR provider exists; this reader never renders a page to an image.
- **No invariant companion** — No runtime invariant companion is published because each document is read in its own worker thread and the single reply it returns is handled by `@aeven/document-extract/execution`, so the package holds no same-process event sequence to compare; it contributes one provider registration and a `DocumentExtractionLimiter` to `ctx.documentExtract`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
