---
description: "The document package group: the ctx.documentExtract registry and the readers that turn an uploaded document or recorded clip into text a model can read."
kind: "package-group"
---

# document/ — document text extraction

English | [中文](README.zh.md)

## Summary

The document group turns an uploaded document or a recorded clip into text a model can read. An upload asks `ctx.documentExtract` which readers claim the file, then runs them in priority order until one returns text, and that text travels with the attachment into the conversation. A deployment adds a format by mounting another provider, not by changing the upload path. Five packages form the family: the registry, a built-in JavaScript reader, a LibreOffice-backed Office reader, an OCR reader for scanned PDFs, and a video reader. The group owns extraction alone; the upload route enforces file types and sizes.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

The registry routes each document to one reader; every other package registers one reader into it at a fixed priority.

| Package | Role |
|---|---|
| [`document-extract/`](document-extract/README.md) | Owns `ctx.documentExtract`: provider registration, priority routing, the text budget, and the failure codes |
| [`document-extract-js/`](document-extract-js/README.md) | Reads PDF, Office Open XML, OpenDocument, iWork, RTF, EPUB, HTML, and text formats in worker threads, at priority 0 |
| [`document-extract-office/`](document-extract-office/README.md) | Reads legacy Word, Excel, and PowerPoint through the bundled LibreOffice engine, at priority 10 |
| [`document-extract-ocr/`](document-extract-ocr/README.md) | Recognizes a scanned PDF with pdf.js and Tesseract after the built-in readers return no text, at priority 20 |
| [`document-extract-video/`](document-extract-video/README.md) | Describes an uploaded or recorded clip from the host's `ffprobe` output, at priority 10 |

<a id="related-documentation"></a>
## Related documentation

- [Document extraction subsystem](../../docs/subsystems/document.md) — the `ctx.documentExtract` operations, format routing, and the failure codes.
- [Session controller](../api/session-controller/README.md) — the upload route that accepts a file, stores its text on the attachment, and enforces type and size limits.
- [Attachment store](../attachment/attachment/README.md) — the durable references that carry the extracted text into a prompt.
- [Capability seams](../../docs/glossary.md#capability-seam) — the Service Definition, Service Provider, and Consumer roles this group is built from.

<a id="dev-note"></a>
## Dev Note

None.
