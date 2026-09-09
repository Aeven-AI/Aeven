# Agent Note: HyperMarkdown owns streaming finalization

Status: implemented

English | [中文](2026-09-08-hypermarkdown-streaming-finalization.zh.md)

## Problem

`MarkdownText` enabled HyperMarkdown's word animation while a reply streamed, but replaced the streaming render with a one-shot settled parse as soon as the reply finished. That replacement removed the final animation spans before their CSS animation completed, so the last words appeared without finishing their fade. Delaying the replacement in the adapter would duplicate the renderer's animation duration and fail whenever the renderer changed its timing.

The Aeven client leaves one streaming HyperMarkdown instance mounted and finalizes it through the imperative renderer API. HyperMarkdown publishes that final render through its internal external-store hook; the host does not schedule a later replacement.

## Decision

`MarkdownText` follows the renderer lifecycle. It continues to translate accumulated source into deltas, enables `animation`, and calls `write(finalDelta, true)` when `streaming` changes to false. HyperMarkdown's external-store subscription publishes the finalized render, and the adapter leaves that render mounted. A terminal source replacement resets the store and writes the replacement with `finalize` enabled so the replacement receives the same animation behavior.

A reply mounted in its settled state still uses `setMarkdown`. Only a live streaming-to-settled transition stays on the streaming representation.

This supersedes only the finalization choice in [the HyperMarkdown engine note](../architecture/2026-08-28-web-markdown-hypermarkdown-engine.md). Its engine ownership, security policy, and accumulated-string adapter decisions remain current.

## Testing

The incremental client tests replay prose, fences, tables, lists, and mixed Markdown through streaming finalization, cover mid-stream mounts, source replacement, and React Strict Mode, and assert that animation nodes remain mounted after an `animationend` event and an unchanged settled rerender. The DOM fixtures pin the renderer's animation markers and word wrappers for streaming mounts. The built web client is also exercised through a real model reply to verify that the final animated node reaches `animationend` and remains in the DOM.

## Alternatives considered

**Run the settled parse immediately.** Rejected because it removes the renderer-owned animation nodes during the final fade.

**Run the settled parse after a timeout.** Rejected because the adapter would hardcode timing owned by HyperMarkdown and could drift from its CSS.

**Wait for animation DOM events before running the settled parse.** Rejected because the renderer does not expose its animation roots through the adapter API, and observing generated markup would couple the host to private DOM details.

## Consequences

The last word fade completes through the same hook and store lifecycle as the Aeven reference client, with no host timer and no second parse. A finalized live reply retains HyperMarkdown's animation wrappers. Streamed fences and tables can remain sensitive to network chunking; this tradeoff accepts the renderer's streaming representation so its lifecycle is not interrupted by the host.
