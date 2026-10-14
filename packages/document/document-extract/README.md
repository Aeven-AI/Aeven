---
description: "The document text-extraction service (ctx.documentExtract): provider registration, format routing, the text budget, and the failure codes."
kind: "package-reference"
---

# @aeven/document-extract

English | [中文](README.zh.md)

## Summary

`@aeven/document-extract` registers `ctx.documentExtract`, the provider registry every document consumer shares. A provider registers under its own id with the formats it reads and a priority; `accepted()` reports the union of those formats before an upload is read, and `extract()` routes the bytes to the first provider claiming the extension or media type, falls through a provider that fails or returns no text, then cuts the result to `maxTextChars` and names the producing provider. Failures are `DocumentExtractError`s with the code `UNSUPPORTED_FORMAT` or `EXTRACTION_FAILED`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the service in the host composition; `@aeven/api-session-controller` reads it for conversation uploads. Providers are separate packages — `@aeven/document-extract-js`, `@aeven/document-extract-ocr`, and `@aeven/document-extract-office` — each registering under its own id.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxTextChars` | `400000` | Characters kept from one document; longer text is cut and marked `truncated` |

<a id="model-experience"></a>
## Model Experience

### Extracted document text

#### What the model sees

This package registers no prompt, tool, or session event. The text `extract()` returns is stored as the uploaded file's own text by the consumer that accepted the upload — `@aeven/api-session-controller` does so for a conversation upload — so a model reads it as that file's content, with `truncated` marking a cut to `maxTextChars`.

#### Token effect

Bounded per document by `maxTextChars`, and paid only in the request that carries the uploaded file.

#### KV Cache effect

Append-only: the extracted text enters the request with the message that carries the file, so an unchanged conversation keeps its prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A failed claim is reported, not attributed** — when every claimant fails, the registry throws one `EXTRACTION_FAILED` error carrying the first failure as `cause`, so a caller cannot tell which provider broke.
- **No invariant companion** — No runtime invariant companion is published because the provider table has one writer and no event stream: `register` refuses an id that is already taken, its disposer removes only the provider it added, and `extract` reads the same table, so a listener would repeat the operation it claims to verify; format routing, the text budget, and provider fall-through are asserted in `tests/registry.spec.ts`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
