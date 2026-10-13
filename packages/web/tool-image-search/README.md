---
description: "The model-facing find_images tool: how a reply shows real photographs of a subject or news stories as cards, where they come from, and what the model is told about them."
kind: "package-reference"
---

# @aeven/tool-image-search

English | [中文](README.zh.md)

## Summary

`@aeven/tool-image-search` registers one model-facing tool, `find_images`, which finds real photographs of a subject and shows them to the reader. A question about how something actually looks — a building, a place, an object, an artwork, an event — is answered with the photographs rather than a description of them. For news, the same tool turns the articles the model chose into cards: each story's image, headline, opening text and source.

The images arrive as ordinary image content blocks, so the client draws them in the same lane a generated image uses, and the session log carries them the same way. Nothing about the reader's view is special to this tool.

Photographs come from Wikimedia Commons first: its API returns the file page and the licence with every match, needs no credential, and its historical photography is public domain or openly licensed. The `web` seam, when the deployment mounts one, supplies what Commons does not hold — the image each result page publishes as its own, cited by that page.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin wherever a session's tools are composed; the shipped `aeven` preset carries the row, so every session gets the tool. It requires the `tools`, `attachments` and `llm` services: `attachments` makes the found images durable, and `llm` translates cards. The `web` service is optional; without it there are no cards and no photographs beyond Commons.

Every field is optional; invalid values fail plugin load.

| Field | Default | Effect |
| --- | --- | --- |
| `requestTimeoutMs` | `20000` | Milliseconds one HTTP request — to Commons, a web search, a page, or an image — may take. |
| `translationTimeoutMs` | `30000` | Milliseconds the model call that translates the cards may take. |
| `maxImageBytes` | `12582912` | Largest image one call stores. A larger file is left out of the row. |

The tool's own deadline is four requests plus the translation, since a call makes at most four rounds of requests one after another.

```yaml
- id: tool-image-search
  name: '@aeven/tool-image-search'
  config:
    requestTimeoutMs: 20000
```

<a id="understand-the-implementation"></a>
## Understand the implementation

A row searches Commons' `generator=search` over the `File:` namespace, keeps only results whose media type is a bitmap (`image/jpeg`, `image/png`, `image/webp` — a PDF, an SVG, or a video is not a photograph), and asks for each match's thumbnail at 1600px. When Commons returns fewer than the row needs, a web search fills it: each result page is fetched, and its `og:image` or `twitter:image` is the photograph.

Cards skip Commons, because a file name is not a headline. With `urls`, each named article is fetched; without them, a web search supplies the pages. A card is the page's published image, its title (the search title, else `og:title`, else `<title>`), and its opening text: the first paragraphs of `<article>` or `<main>` that are not page furniture such as photo credits or follow prompts, up to 320 characters, falling back to the page's description. Text is entity-decoded, twice when a page escaped it twice, and is cut at a sentence or a whole word, never mid-word.

Pages are fetched in parallel, and images are downloaded and stored through `ctx.attachments.saveImage` in parallel batches the size of what the row still needs, so a file that fails is replaced by the next candidate. Every request gets its own `requestTimeoutMs` deadline fused with the caller's signal. One page or image that fails is left out rather than failing the call.

When the call names a `language`, the session's own model translates the cards' headlines and openings under its own `translationTimeoutMs` deadline; a translation that fails or times out leaves the source text. The tool may run beside sibling calls (`isConcurrencySafe`), since the attachment store keys files by content.

Parsing is a wire boundary: every field of a Commons response and every page is read defensively, and a result the tool cannot describe is skipped instead of guessed at.

<a id="model-experience"></a>
## Model Experience

The tool is visible to the model as `find_images`, with `query`, `count` (1 to 6, default 3), `layout` (`row` or `cards`), `urls` (with `cards`, up to 10 article pages, one card each), `language`, and `translations`. A call needs `query` or `urls`. Its description states when to reach for it — a subject that exists and has been photographed, a request for photos, or a picture that carries the answer better than prose — that it must never describe a photograph it has not shown, and that news passes its chosen articles as `urls` with `cards`.

For a row, the result text instructs the model not to write the images again as markdown, because they are already displayed, and lists each file's page and licence so the reply can cite them. For cards, it tells the model the stories are already shown, each linking to its article, and not to list them again as links or headlines. A second text block carries the items as JSON for the client's card view; the image blocks follow.

#### KV Cache effect

None; the tool contributes one tool definition and no request-time text of its own.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One package, not a seam.** The Commons search, the page scraping, the download, and the tool live in this package rather than in a capability seam of their own. A third source, or a consumer that is not a tool, is what should split the providers out.
- **Opening text is scraped.** A card's text is read from the page's paragraphs with patterns rather than a readability parser, so an unusual page can still lead with furniture the patterns do not name.
- **Landscape and portrait are decided by the reader's browser.** The tool stores whatever the file is; the client shapes each tile from the loaded image, so this package has no say in how a row is laid out.
- **No test suite yet.** The package was brought up against live sessions; its specs, including the wire-boundary parsing and the size and timeout bounds, are still to be written.
