# Agent Note: Refused and failed images say so too

Status: implemented

English | [中文](2026-11-11-refused-and-failed-images-say-so.zh.md)

## Problem

[An image that cannot load says so](2026-11-11-an-unloadable-image-says-so.md) drew a visible block only when the host's resolver returned no URL. Once [workspace images](2026-11-11-markdown-images-load-through-the-workspace-route.md) gave every local source in assistant Markdown a URL, that branch stopped being reached for the failures readers actually hit (#630):

- A wrong or deleted workspace path resolves to `/api/workspace-file`, the route answers 404, and the `<img>` had no `onError`: the reader saw an empty image box.
- On a hosted Host, an absolute path outside the workspace still resolves to `/api/file`, which hosted profiles do not mount: the same empty box.
- A source link safety refuses (`http:`, `//`, a disallowed scheme) was replaced with its alt text in the rehype pass, before the image component ran: bare text, or nothing when the author wrote no alt.

## Decision

`MarkdownImage` shows the unavailable block in all three cases. It remembers the URL whose load failed and draws the block for that URL; a later resolver revision that names a different URL tries again. `rehypeLinkSafety` no longer splices a refused image into a text node: it drops `src` and keeps the authored source as `data-blocked-src`, which the image component names in the block. Every component map the engine builds (top level, cached blocks, table and list cells) draws `img` through `MarkdownImage`, so no `<img>` without `src` reaches the page.

The deliberate cases are unchanged: a host that supplies no `imageUnavailableLabel` still gets alt text only, and an image the host suppresses through `imageVisible` stays silent.

## Alternatives considered

**Tell the client which file routes the Host serves**, so a hosted client never builds an `/api/file` URL. That needs a new remote method, a client fetch, and plumbing into every `MarkdownText` resolver, and it saves one 404 request. The load-failure branch already shows the right state for that source, and the same branch covers deleted files, which no capability flag can predict.

## Consequences

Every Markdown image either loads or names its source in the reader's language. The block still does not say why a source failed and offers no retry; a transient network failure stays in the unavailable state until the resolver changes.
