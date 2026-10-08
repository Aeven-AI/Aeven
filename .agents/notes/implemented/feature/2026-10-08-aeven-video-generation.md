# Agent Note: Aeven video generation at its tool call

Status: implemented

English | [中文](2026-10-08-aeven-video-generation.zh.md)

## Problem

The Aeven gateway serves `Aeven-1.0-Video-Pro` at `POST /v1/videos`, but no Aeven session could reach it: `media-aeven` registered only an image provider, `tool-media` published only `generate_image`, and no client view plays a clip.

## Decision

`media-aeven` registers a video provider beside its image provider. It starts the gateway job with `Prefer: respond-async`, reads `GET /v1/videos/{id}`, and maps `in_progress`, `completed` and `failed` onto the seam's `running`, `succeeded` and `failed`. `fetchVideo` downloads the HTTPS URL the completed job's result names, bounded by `maxVideoBytes`. Local reference images become the first and last frame, because the gateway's other reference fields take only HTTPS or `asset://` URLs.

`tool-media` publishes `generate_video` where its `video` config is set. One call starts the job, waits for it, and stores the clip with `ctx.attachments.saveFile`; the result cites it as a file block. The model reads that block as an `<attached_file>` element, and `/api/attachment-file` serves it to the client because the session log cites it. The image tool's model selection becomes `installSelection`, shared by both kinds, so `/video-model`, its picker and the `media-video` settings document behave as `/image-model` and `media` do. The shipped preset offers Video Pro as the default with `confirmModel: false`.

Imagine registers `VideoToolView` for `generate_video`. The call shows the image card's frame with its spinner while the job runs, then the clip under `VideoPlayer`'s own chrome in the same frame, with no lightbox. The chrome is the product's own instead of the browser's: a white play disc carrying the lucide glyph, the elapsed and total readout, a scrubber, a white volume disc with its own level slider, a save popup opened from a vertical-dots disc whose download row holds the composer's own popup card and cell recipe, and a white full-screen disc, so the controls look like the rest of the client rather than like the browser. The clip's own events drive every face, full screen is taken on the player element so the chrome stays on the full-screen surface, and playback clears the bar once the pointer has left it alone. `/api/attachment-file` answers single byte ranges with `206`, which lets the player seek.

## Consequences

A video call stays open for the whole render, up to `maxWaitMs`, so the model does no other work in that turn meanwhile. The clip is a durable file attachment owned by the session log like any upload. This supersedes the [generated images note](2026-10-02-generated-images-at-tool-calls.md)'s statement that video generation remains separate: the call settles only once the clip's bytes are stored.

## Verification

Validation is limited to TypeScript checking and the build at the user's request: no test suite or live generation call is run.

## Alternatives considered

A start tool plus a status tool, as the Grok Imagine video tools use, leaves the model to poll and gives the transcript no single call to show a clip at. Storing the clip in a private media store with time-limited routes, as `subscription-auth` does, would add a second storage owner beside the attachment store, and the clip would no longer be referenced from the session log. Asking the gateway for a synchronous response would tie a paid render to one HTTP connection.
