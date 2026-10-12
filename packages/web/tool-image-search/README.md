---
description: "The model-facing find_images tool: how a reply shows real photographs of a subject, where they come from, and what the model is told about them."
kind: "package-reference"
---

# @aeven/tool-image-search

English | [中文](README.zh.md)

## Summary

`@aeven/tool-image-search` registers one model-facing tool, `find_images`, which finds real photographs of a subject and shows them to the reader. A question about how something actually looks — a building, a place, an object, an artwork, an event — is answered with the photographs rather than a description of them.

The images arrive as ordinary image content blocks, so the client draws them in the same lane a generated image uses, and the session log carries them the same way. Nothing about the reader's view is special to this tool.

Commons is the source: its API returns the file page and the licence with every match, needs no credential, and its historical photography is public domain or openly licensed. A source that answered without those fields could not be cited.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin wherever a session's tools are composed; the shipped `aeven` preset carries the row, so every session gets the tool. It requires the `tools` and `attachments` services: `attachments` is what makes the found images durable.

Both fields are optional; invalid values fail plugin load.

| Field | Default | Effect |
| --- | --- | --- |
| `requestTimeoutMs` | `20000` | Milliseconds one HTTP request to Commons or to an image may take. |
| `maxImageBytes` | `12582912` | Largest image one call stores. A larger file is left out of the row. |

```yaml
- id: tool-image-search
  name: '@aeven/tool-image-search'
  config:
    requestTimeoutMs: 20000
```

<a id="understand-the-implementation"></a>
## Understand the implementation

One call searches Commons' `generator=search` over the `File:` namespace, keeps only results whose media type is a bitmap (`image/jpeg`, `image/png`, `image/webp` — a PDF, an SVG, or a video is not a photograph), downloads each match's widest thumbnail at 1600px, and stores it through `ctx.attachments.saveImage`. The result carries the stored attachments plus the text the model reads.

Two bounds keep a call honest: the request deadline is the configured timeout fused with the caller's signal, and one image that cannot be fetched or stored is left out rather than failing the whole row.

Parsing is a wire boundary: every field of a Commons response is read defensively, and a result the tool cannot describe is skipped instead of guessed at.

<a id="model-experience"></a>
## Model Experience

The tool is visible to the model as `find_images`, with a `query` and an optional `count` (1 to 6, default 3). Its description states when to reach for it — a subject that exists and has been photographed, a request for photos, or a picture that carries the answer better than prose — and that it must never describe a photograph it has not shown.

The result text names what was found and instructs the model not to write the images again as markdown, because they are already displayed; it lists each file's page and licence so the reply can cite them. The image blocks travel beside that text.

#### KV Cache effect

None; the tool contributes one tool definition and no request-time text of its own.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One source, and one package.** Wikimedia Commons is the only provider, and the search, the download, and the tool live in this package rather than in a capability seam of their own. A second source, or a consumer that is not a tool, is what should split the provider out.
- **No fallback for a subject Commons does not hold.** Contemporary news, products, and living people are largely absent there. Answering those needs a second provider, not a change here.
- **Landscape and portrait are decided by the reader's browser.** The tool stores whatever the file is; the client shapes each tile from the loaded image, so this package has no say in how a row is laid out.
- **No test suite yet.** The package was brought up against live sessions; its specs, including the wire-boundary parsing and the size and timeout bounds, are still to be written.
