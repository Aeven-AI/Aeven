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

### The `find_images` tool schema

#### What the model sees

The one entry this package registers in the generated [tool catalog](../../../docs/tool-catalog.md#aeventool-image-search): the name `find_images`, a description stating when to reach for it and that a photograph it has not shown must never be described, and six parameters — `query`, `urls`, `count`, `layout`, `language`, and `translations`, one entry per result position with a `title` and a `summary`. The result is two text blocks followed by the stored images as image blocks, in the order the items were shown.

#### Token effect

Fixed: one tool definition in every request of a session that composes this package, independent of any call. What a result adds is its own text — at most `count` lines for a row, or one numbered line per named article for cards.

#### KV Cache effect

Prefix-stable while the visible tool set is unchanged; adding or removing the package, or renaming the tool, rebuilds that list. A result is appended after the user's message.

### The result text

#### What the model sees

The first text block of a call counts what was shown, tells the model the images are already displayed so it must not write them again as markdown, and lists each item as one numbered line naming its title, its source page, and its licence, with a different framing for a row than for cards; a call that found nothing answers with one of the sentences in the last block below. A second text block carries the same items as JSON for the client's card view, and the image blocks follow it.

##### Verbatim row result

```markdown
Found <N> photograph(s) for "<query>".
They are already displayed to the user as one row of images. Do not write them again as markdown images or links.
Cite each one where you use it:
1. <title> — <source> (<license>)
```

##### Verbatim card result

```markdown
Made <N> card(s) for <query or the stories>.
They are already displayed to the user, one card per story with its image, headline, opening text and source, each linking to its article. Do not list these stories again as links or headlines; write only what the cards do not say.
The cards, in order:
1. <title> — <source> (<license>)
```

##### Verbatim row result with nothing found

```markdown
No photographs of "<query>" could be found. Answer without images, and say where you looked.
```

##### Verbatim card result with nothing found

```markdown
No cards could be made for <query>: none of the pages could be read or published an image. Present the stories in prose instead.
```

#### Token effect

Only the result's own text: the framing above is fixed, and one numbered line per item is bounded by `count` (`3` by default, at most `6`) for a row and by the number of named articles, at most `10`, for cards. The JSON block repeats the same items. What the images cost is the model route's own image accounting, not this package's.

#### KV Cache effect

Append-only: the result joins the conversation after the user's message and changes no earlier request.

### The translation call

#### What the model sees

When a call names `language`, supplied no `translations`, and stored at least one item, this package sends one auxiliary request on the session's own route, outside the conversation: its system text is fixed, and its one user message carries the language and the items' titles and openings as JSON.

##### Verbatim translation system text

```markdown
You translate news items for a reader who reads one language. Reply with JSON only, no prose and no code fence: {"items":[{"title":"...","summary":"..."}]}, in the same order and count as the input. Translate every item into the named language, keeping names, numbers, product names and quotations intact. An item already in that language comes back unchanged, character for character.
```

##### Verbatim user message frame

```markdown
{"language":"<the conversation's language>","items":[{"title":"<headline>","summary":"<opening text>"}]}
```

#### Token effect

One auxiliary request per translated call, separate from the conversation's own requests: its input is the items' titles and openings, its output is bounded by `maxTokens` `1600`, and it runs under the configured `translationTimeoutMs` (`30000`), which is also added to the tool's own deadline. A call that fails or times out leaves the source text in place.

#### KV Cache effect

None for the conversation: the request is sent once on the session's route with its own fixed system text, so it neither reads nor extends the conversation's reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One package, not a seam.** The Commons search, the page scraping, the download, and the tool live in this package rather than in a capability seam of their own. A third source, or a consumer that is not a tool, is what should split the providers out.
- **Opening text is scraped.** A card's text is read from the page's paragraphs with patterns rather than a readability parser, so an unusual page can still lead with furniture the patterns do not name.
- **Landscape and portrait are decided by the reader's browser.** The tool stores whatever the file is; the client shapes each tile from the loaded image, so this package has no say in how a row is laid out.
- **No test suite yet.** The package was brought up against live sessions; its specs, including the wire-boundary parsing and the size and timeout bounds, are still to be written.
- **No invariant companion** — No runtime invariant companion is published because every observation it makes comes from a Commons response, a web search, or a fetched page, and the stored images belong to `ctx.attachments`, so this package owns no relation that two observers could disagree about.
