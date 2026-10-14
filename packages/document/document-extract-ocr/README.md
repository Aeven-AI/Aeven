---
description: "The OCR reader for scanned PDFs: pages rendered with pdf.js and recognized with Tesseract in a worker thread, English data bundled."
kind: "package-reference"
---

# @aeven/document-extract-ocr

English | [中文](README.zh.md)

## Summary

`avn-document-extract-ocr` registers the provider `ocr` at priority 20 on `ctx.documentExtract`, so it claims a PDF only after the built-in reader returned no text — a scanned PDF. Pages are rendered with pdf.js on a prebuilt canvas and recognized with Tesseract (WebAssembly) in a worker thread with a wall-clock and heap limit; the English language data and the pdf.js wasm and font files are npm dependencies resolved from the installation, so nothing is downloaded at runtime.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount it beside the service: the plugin registers the `ocr` provider on `ctx.documentExtract`.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxPages` | `30` | Pages recognized at most, from the first |
| `scale` | `2` | Render scale relative to 72 DPI; 2 renders at 144 DPI |
| `timeoutMs` | `300000` | Wall-clock limit for one document before its worker is terminated |
| `maxWorkerHeapMb` | `1024` | Old-generation heap limit of one worker |
| `concurrency` | `1` | Simultaneous OCR workers |
| `recognizers` | `4` | Tesseract recognizers one document's pages are spread across |

<a id="model-experience"></a>
## Model Experience

### Recognized document text

#### What the model sees

This package registers no prompt, tool, or session event, and returns a `method: "ocr"` result. The recognized text reaches a model only through the consumer that accepted the upload, which stores it as that file's text; recognition is a guess about pixels, so the text can carry misread characters where a PDF with a text layer would not.

#### Token effect

Bounded per document by the registry's `maxTextChars` and by `maxPages`, whichever cuts first.

#### KV Cache effect

Append-only: the text enters the request with the message that carries the uploaded file.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **English only** — the bundled recognizer data is `eng`, so a scanned document in another language is recognized as English, or not at all.
- **Recognition is not extraction** — the result is a guess about rendered pixels; nothing records which page or region a line came from, and `pages` reports how many pages were recognized rather than where text was found.
- **No invariant companion** — No runtime invariant companion is published because page rendering and recognition happen inside a worker thread, with the time and heap limits enforced by `@aeven/document-extract/execution`, so no same-process relation exists for a listener to compare; the package contributes one provider registration.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
