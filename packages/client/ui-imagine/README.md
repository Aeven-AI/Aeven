---
description: "The Imagine surface: the /i/<id> page that takes the center column in place of the chat, the in-chat image and video views, and the /image-model and /video-model pickers."
kind: "package-reference"
---
# @aeven/client-ui-imagine

English | [中文](README.zh.md)

## Summary

Imagine is a page of its own at `/i/<id>`, separate from chat Sessions. The plugin claims the `/i` path root on the layout's surface router (`ctx.layout.surfaces`) and contributes its page to the `surface` slot, so while the address is under `/i` the center column shows Imagine instead of the chat, and the chat's details and right sidebar columns stay closed. A bare `/i`, or an id that is not a UUID, is rewritten in place to a fresh `/i/<uuid>`. The id names no Session.

The start page is the chat's New Session screen: the product name and the reader's greeting (the chat's `HeroShell`), over a composer card with the chat hero composer's geometry. The card keeps what the reader types; its add and send controls stay disabled until Imagine can generate.

The same plugin hangs the `/image-model` picker on the host command in the chat composer: one searchable list of the deployment's image models, the stored choice marked active, and a pick submitting `/image-model <provider>/<model>`, which is the line that stores it. The rows are the deployment's configured `choices` plus the models a `listedProviders` provider currently serves, read from this client's `media` settings scope and the seam's own catalog. That is the surface an image model is chosen from while Imagine itself has no model control; the choice is the deployment's image-generation setting, so it is shared with `generate_image` rather than private to this page. `/video-model` gets the same picker over the `media-video` settings scope; its rows are that document's `choices` alone, since no listed provider offers video models.

Image generation in chat is rendered at its tool call by `ImageToolView`, registered for `generate_image`, `codex_image_generate`, `codex_image_edit` and `grok_imagine_image`. Each frame carries a round prompt control in its lower-left corner: it names itself on hover and opens the prompt in the connectors skill popup's dialog, title row carrying a one-click copy. The control sits over the spinner while the call runs and stays on the failure frame. Success uses the shared attachment gallery; a failed call keeps the same reserved frame bare, its message behind a round alert control in the frame's upper-left corner carrying the lucide `circle-alert` glyph, which opens it in the prompt's own dialog. A frame is the box its image is shown in, and a running call already frames the shape its own request names — a `WIDTHxHEIGHT` size or a `W:H` aspect ratio — so its placeholder covers exactly the box the image later fills; a request naming no shape (a resolution tier, `auto`, or no size) frames landscape until its image arrives. A call asking for several images reserves one frame each. These calls remain visible with process collapsed, including nested code dispatches; no progress event or separate image store is added. `VideoToolView`, registered for `generate_video`, renders the same frame: a spinner over a frame in the requested aspect ratio while the job runs, then an inline clip under `VideoPlayer`'s own playback chrome, read from `/api/attachment-file` for the clip the result cites, with the frame taking the clip's own shape once its metadata loads. That chrome is the product's own rather than the browser's: a flat white disc carrying the lucide `play` glyph, the elapsed and total readout, a scrubber, a `volume-2`/`volume-x` disc beside its level slider, a save popup opened from a vertical-dots disc whose `download` row saves the clip under its own file name, drawn with the composer's own popup card and cell recipe, and a `maximize-2`/`minimize-2` disc for full screen. Every face is a white surface carrying the product's black glyph, the clip's own events drive them all, full screen is taken on the player element so the chrome stays with the clip, and a playing clip the pointer has left alone clears the bar until the pointer returns or the clip is held. Its prompt control sits in the upper-left corner, clear of the controls, where a failed frame instead carries the alert control, the prompt control returning to the lower-left.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

None, as nothing on the Imagine page or in its pickers reaches a model request: a picker stores a settings choice and leaves every generation to `generate_image` or `generate_video`.

#### KV Cache effect

None; the page sends no request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Imagine page generation is unavailable** — the composer card accepts text but sends nothing; the add and send controls are disabled.
- **The picker's rows restate the host's choice list** — this plugin merges the settings choices with the listed providers' catalog because that catalog changes with a subscription's sign-in state; the host re-resolves the same two sources when the submitted line arrives and refuses anything outside them, so a row the host no longer offers surfaces as that command's error.
- **The composer card restates the chat card's CSS** — its values follow ui-conversation's hero composer, so a change there has to be carried here until the two composers share one component.
- **No navigation entry** — the sidebar's Imagine row does not link here yet; the page is reached by its address.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
