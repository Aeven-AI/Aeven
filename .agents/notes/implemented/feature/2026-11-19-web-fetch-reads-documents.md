# Agent Note: web_fetch reads PDF and Office documents

Status: implemented

English | [中文](2026-11-19-web-fetch-reads-documents.zh.md)

## Problem

On Æven Web, a user asked for the participant list of a government tender. The list was published as a PDF on TenderNed, and the model answered that it could not open PDFs with its tools and could only read them through the browser on the user's machine. `avn-web-fetch-http` classified only HTML, `text/*`, and JSON/XML responses, so every `application/pdf` response failed with `WEB_UNSUPPORTED_CONTENT_TYPE`. Tender sites, ministries, and journals publish their primary documents as PDF, Word, and Excel files, so a plain fetch could not read the material users ask about most often in research tasks. The Host already read the same formats for file uploads through `ctx.documentExtract`.

## Decision

`WebFetchBody` gains a `document` arm that carries the complete file bytes, the response media type, and a file name taken from `Content-Disposition` or the URL's last path segment. `avn-web-fetch-http` classifies PDF, Word, Excel, PowerPoint, OpenDocument, RTF, EPUB, and `application/octet-stream` as `document`, reads the body under the separate `maxDocumentBytes` cap (default 25,000,000), and refuses a larger document with `WEB_FETCH_TOO_LARGE` because a byte-truncated PDF or ZIP container cannot be parsed. An `application/octet-stream` body that starts with `%PDF-` is labelled `application/pdf`. The `Accept` header adds `application/pdf;q=0.8,*/*;q=0.5` so servers that negotiate content serve the file.

`avn-tool-web` converts a `document` body inside `web_fetch` through the optional `ctx.documentExtract` service (`ctx.get`), forwarding the tool-call signal. The recorded output value replaces the bytes with `{ kind: 'document', mediaType, content }`, the result header reads `Fetched <url> (HTTP <status>, text extracted from <media type>)`, a document without a text layer renders `[The document contains no extractable text.]`, and the result is `truncated` when the extractor cut the text. Without the service, or when no registered reader accepts the format, the call fails with `WEB_UNSUPPORTED_CONTENT_TYPE`. The tool description names the readable formats so the model stops refusing them.

Extraction runs in the document providers' worker threads under the `web_fetch` budget (`fetchTimeoutMs`, 30 s by default); a timeout aborts the signal and terminates the worker. A 2.2 MB, 15-page PDF downloaded in about 0.5 s and extracted in about 0.5 s. A scanned PDF falls through to OCR where `document-extract-ocr` is mounted and usually exceeds the 30 s budget.

## Alternatives considered

- **Extract text inside `avn-web-fetch-http`.** The provider would need the document registry and would return text that no longer says it came from a document. Keeping bytes on the seam lets each Consumer choose: `web_fetch` extracts, `avn-tool-image-search` ignores non-HTML bodies.
- **Truncate a large document like text.** A cut PDF loses its cross-reference table and a cut Office file loses its ZIP directory, so truncation produces an unreadable body instead of a shorter one.
- **Accept images, audio, video, and archives.** They need a vision, transcription, or unpacking path rather than text extraction; ZIP bundles on tender sites remain unsupported.
- **Send the user to the browser for PDFs.** That was the shipped behavior and the reported failure.

## Consequences

The model can read published reports, tender documents, papers, and spreadsheets from a URL, and the session log records the extracted text the model saw. A long document can return up to `fetchMaxOutputChars` (200,000 characters) into context, the same bound HTML has. Document fetches share the extraction workers with file uploads (`document-extract-js` concurrency 2). Compositions without `document-extract`, including the headless and SDK profiles, now report a document as unreadable through `web_fetch` with the same error code as before, with a message naming the missing reader. Legacy `.doc`, `.xls`, and `.ppt` files need `document-extract-office`.

## Testing

`packages/web/web-fetch-http/tests/fetch-http.spec.ts` covers document classification, file naming, whole-body reads, the PDF signature, and the document byte cap at, above, and declared above its limit. `packages/web/tool-web/tests/tool-web.spec.ts` covers extraction through the real `DocumentExtract` registry, the header, the empty-text marker, extractor truncation, and both failure paths. The `snapshots/session/web-fetch-document` scenario records a live fetch of a fixture PDF served without a file extension and the model's answer from its text.
