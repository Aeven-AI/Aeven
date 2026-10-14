# Agent Note: Photographs in a reply

Status: implemented

English | [中文](2026-10-12-photographs-in-a-reply.zh.md)

## Problem

A question about how something actually looks was answered only in prose. "Crystal palace. Did it ever exist?" produced a good text answer and no picture, while the same question on chatgpt.com produced a row of photographs with their sources.

Nothing in the harness could fetch a photograph. The `web` capability's providers return text; `find`/`fetch` return text; the only tool that produced an image block was image generation, which invents an image rather than showing the real thing. So the gap was retrieval, not rendering: the Markdown engine already rendered an image, and the client already drew a row for images a tool returns.

## Decision

`@aeven/tool-image-search` registers one model-facing tool, `find_images(query, count?)`. It searches Wikimedia Commons' `File:` namespace, keeps only bitmaps, downloads each match's 1600px thumbnail, stores the bytes through `ctx.attachments.saveImage`, and returns ordinary image content blocks plus a text summary naming each file's page and licence. Commons is the first source because its API returns the licence and the file page with every match, needs no credential, and its historical photography is openly licensed or public domain — a source that answered without those fields could not be cited.

The images travel as image blocks, so the client draws them in the same lane a generated image uses and the session log carries them the same way. The tool's result text tells the model the images are already displayed and not to write them again.

The tool is mounted for every session from the `aeven` preset, and the preset prompt states the behaviour: when the subject exists and has been photographed, show the photographs rather than describing them, without being asked.

Two rendering changes went with it, because a row of photographs has to look like the row the generator produces:

- The engine groups a run of images written on consecutive blocks — including several images inside one paragraph, which a model produces with soft line breaks — into one `div.markdown-image-grid` carrying `data-count`. Grouping is structure only, added after sanitization: how a tile looks stays with the host.
- A rendered image reports its own orientation once it loads (`data-orientation`), so the host shapes a landscape tile 3:2 and a portrait one 2:3, and a lone portrait never runs the full column.

## Alternatives considered

**Let the model write Markdown image URLs.** No retrieval and no licence: the model would have to know a URL, the reply would hotlink a host that may refuse it, and nothing would verify the image exists or shows the subject.

**Add a model-authored HTML surface, as ChatGPT's visualizations do.** A new sandbox, a CSP allowlist, and a second design system to keep in step — all for the half that already worked, since the engine and the client could already display images.

**Ask the model to describe photographs it knows.** Unverifiable and stale, and it cannot show anything.

## Consequences

A clean session now answers that question with cited photographs from Commons, drawn in the generator's lane at its own geometry.

Commons holds little contemporary material, so news, products, and living people come from the `web` seam's result pages, and news reads as cards built from the articles the model chose ([videos and news cards](2026-10-13-videos-in-a-reply-and-news-cards-from-articles.md)); the search, the scraping, the download, and the tool still live in one package rather than split across a capability seam.

The package ships without specs: its wire-boundary parsing, its timeout, and its size bound are unmeasured, and the row's layout is verified only in a live session. The preset row takes effect on the next Host start, so a server already running keeps answering in prose until it is restarted.
