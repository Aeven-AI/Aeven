# Agent Note: Motion films play on the account's other devices

Status: implemented

English | [中文](2026-11-06-motion-film-on-other-devices.zh.md)

## Problem

The Motion card fetched its film from `/api/motion/preview` on the Host serving the page, naming the composition folder by its absolute path on the device that ran `show_motion`. A conversation synced to another device, such as hosted Web, kept the card but not the folder, and hosted does not mount `api-motion`, so the card showed "not found" in place of the film.

## Decision

`ctx.motion` gains `bundle(compositionDir)`, which returns the composition as one self-contained HTML document; `avn-motion-hyperframes` implements it with `bundleToSingleHtml`, and `api-motion`'s preview route returns it. `show_motion` stores that document as a `text/html` file attachment and records it in its result and presentation metadata as `film`, so session sync publishes it with the conversation. The card still asks its Host for the folder's live preview first, and plays the stored film when the preview fails; a stored film's download saves the HTML document, because the MP4 export needs the Host holding the folder. A composition the bundler rejects, or one over the attachment size limit, keeps only its live preview.

Calls without a stored film, including every call made before it existed, play through `api-motion`'s replay route, which hosted now mounts: the Host rebuilds the folder from the conversation's successful `write` and `edit` calls up to that `show_motion` call, writes the files to a private scratch folder, and bundles them; the bundler inlines only files inside that folder.

## Alternatives considered

Rendering an MP4 at every `show_motion` call was rejected: it takes about as long as the film plays, while bundling takes a moment. Syncing the composition folder itself would need workspace file sync for every chat folder, which hosted does not mount.

## Consequences

A card on another device plays the film as it was at that call, not the folder's later edits. A replay holds only files the log wrote; a composition built by commands or with image assets plays incompletely there. The model-visible result text is unchanged.

## Verification

Typecheck and build pass for the motion packages and `ui-imagine`. Replaying the hosted log of a desktop-made conversation rebuilt its `compositions/chart.html` identical to the file on the Mac.
