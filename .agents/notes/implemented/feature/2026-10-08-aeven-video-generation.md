# Agent Note: Aeven video generation at its tool call

Status: implemented

English | [中文](2026-10-08-aeven-video-generation.zh.md)

## Problem

The Aeven gateway serves `Aeven-1.0-Video-Pro` at `POST /v1/videos`, but no Aeven session could reach it: `media-aeven` registered only an image provider, `tool-media` published only `generate_image`, and no client view plays a clip.

## Decision

`media-aeven` registers a video provider beside its image provider. It starts the gateway job with `Prefer: respond-async`, reads `GET /v1/videos/{id}`, and maps `in_progress`, `completed` and `failed` onto the seam's `running`, `succeeded` and `failed`. `fetchVideo` reads inline clip bytes or downloads the HTTPS URL the completed job's result names, bounded by `maxVideoBytes`. One local reference image becomes the first frame, because the gateway's other reference fields take only HTTPS or `asset://` URLs.

`tool-media` publishes `generate_video` where its `video` config is set. One call starts the job, waits for it, and stores the clip with `ctx.attachments.saveFile`; the result cites it as a file block. The model reads that block as an `<attached_file>` element, and `/api/attachment-file` serves it to the client because the session log cites it. The image tool's model selection becomes `installSelection`, shared by both kinds, so `/video-model`, its picker and the `media-video` settings document behave as `/image-model` and `media` do. The shipped preset offers Video Flash as the default with `confirmModel: false`. The gateway routes Flash to Veo 3.1 Fast and Pro to Veo 3.1 through DeepInfra, with one OpenRouter fallback on provider unavailability or rate limits. Both tiers offer 8 seconds, 720p/1080p, 16:9 or 9:16, audio and one starting image; Pro trades speed and cost for quality. The shipped catalog describes those limits so the model cannot select Pro to request a Seedance-only duration or aspect ratio.

Every `generate_video` execution waits for a separate `userQuestions` confirmation before calling `ctx.media.startVideo`. Only the current question's explicit approval authorizes one call. No UI, cancellation, free text or a stored model choice can authorize a render. The question shows the selected model, requested settings and prompt. The tool description requires a current generation request and forbids treating feedback, troubleshooting or prior requests as permission to retry.

Imagine registers `VideoToolView` for `generate_video`. The call shows the image card's frame with its spinner while the job runs, then the clip under `VideoPlayer`'s own chrome in the same frame, with no lightbox. The chrome is the product's own instead of the browser's: a white play disc carrying the lucide glyph, the elapsed and total readout, a scrubber, a white volume disc with its own level slider, a save popup opened from a vertical-dots disc whose download row holds the composer's own popup card and cell recipe, and a white full-screen disc, so the controls look like the rest of the client rather than like the browser. The clip's own events drive every face, full screen is taken on the player element so the chrome stays on the full-screen surface, and playback clears the bar once the pointer has left it alone. `/api/attachment-file` answers single byte ranges with `206`, which lets the player seek.

## Consequences

A video call stays open for the whole render, up to `maxWaitMs`, so the model does no other work in that turn meanwhile. The clip is a durable file attachment owned by the session log like any upload. This supersedes the [generated images note](2026-10-02-generated-images-at-tool-calls.md)'s statement that video generation remains separate: the call settles only once the clip's bytes are stored.

## Verification

The media provider tests pin both catalogs and rejection of unsupported durations, resolutions and aspect ratios. The recorded-session harness has no video-provider fixture; the catalog snapshot and live UI generation cover this path.

## Alternatives considered

**Prompt-only authorization.** Instructions can reduce unsolicited calls but cannot stop a model that misreads feedback as permission to spend. The executor requires a human answer for each call, independently of the model picker.

A start tool plus a status tool, as the Grok Imagine video tools use, leaves the model to poll and gives the transcript no single call to show a clip at. Storing the clip in a private media store with time-limited routes, as `subscription-auth` does, would add a second storage owner beside the attachment store, and the clip would no longer be referenced from the session log. Asking the gateway for a synchronous response would tie a paid render to one HTTP connection.
