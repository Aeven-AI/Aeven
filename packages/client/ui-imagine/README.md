---
description: "The Imagine surface: the /imagine start address with its starter-prompt grid and preset popup, the in-chat image and video views, and the /image-model and /video-model pickers."
kind: "package-reference"
---
# @aeven/client-ui-imagine

English | [中文](README.zh.md)

## Summary

Imagine is a start address of the chat at `/imagine`. The plugin claims the address on the Workspace UI's start-address face and, while it is the address, the conversation shows this plugin's starter-prompt grid in place of a blank Session's Hero, with the resident composer on the column's floor. Choosing a prompt fills that composer; sending it is an ordinary first message, after which `generate_image` makes the images. The sidebar's Imagine row opens `/imagine`.

The grid holds the starter prompts in display order: Instagram original, then Instagram retouch, then Aerial view, then the illustrated ideas. A prompt's card shows the example image it ships from the web app's `imagine-prompts/` assets, and a card whose asset is absent or fails to load falls back to a title-only card. Clicking a card opens that prompt's popup: the example — the before and after pair of a card that edits a photo, or the single guide image of a prompt that invents its scene — beside its title, its one-line description with a `See more` toggle, the aspect-ratio choice with the pixel size it states, a photo picker where the prompt edits a photo, and the exact message the composer would receive, with a copy control over it.

Aerial view is the second editing card and the deliberate opposite of the retouch. Its prompt is one ask — re-shoot the exact same place and subject as a real drone photograph from high above — plus two guards: not an illustration or a map, and not a miniature or tilt-shift effect. There is no craft paragraph, so the light, the grain and the finish are left to the model; the demo pair on the card is what verifies that a prompt this short still delivers, and the wording names the floor or the ground rather than the ground alone, so a kitchen works as well as a pool deck.

Instagram original invents its picture per open. The popup draws one scene from a pool of sixteen — a glossy studio colour block, a studio portrait, a street stride, a rooftop party at golden hour, a neon alley, a mirror-ball dance floor, a surfer at sunset, a chef's flame, a Mediterranean cove from above, a breakfast terrace, an ochre old-town alley, a turquoise alpine lake, dunes at dusk, a climber above the clouds, a dessert counter, a flash-lit bouquet — and one colour and finish from six, then composes both into the fixed craft the dictionary holds: purposeful light with crisp specular highlights, detail held in the highlights and the blacks, sharp focus with real depth behind it, subtle grain, clean graphic space, and the same exclusions. Colour is saturated throughout and never muted — the pools are written to keep it that way, so a scene is only in the list if it carries colour, light or a striking graphic idea of its own. `Another idea` walks the pool one step, so consecutive presses never repeat a scene, and the prompt preview always shows the scene, the colour and the size that would be sent. Nothing is left to the model to invent: the randomness is decided where the reader can read and edit it.

`Try it` writes that message into the composer and stages the chosen photos as that draft's images; it never sends, so the reader edits and sends like any other message. The photos register through the conversation input's `addImageFiles` — the same intake the composer's own attach control uses — so media types, per-message limits, and preview-URL ownership stay with ui-conversation, and a refusal appears in the popup while nothing is written. A prompt that edits a supplied photo keeps `Try it` live with no photo staged: its message carries one sentence asking for the photo, so the reader either picks one in the popup or attaches it in the composer.

The aspect-ratio choice reaches the model inside that message as a `WIDTHxHEIGHT` size line, because the Aeven image providers refuse an aspect-ratio field and the model is what passes `size` to `generate_image`. `Auto` states no size and leaves the frame to the model and the supplied photo. The sizes are 2K-class — 2048x2048, 1638x2048, 1152x2048, 2730x1536 — scaled up from Instagram's own export sizes so a downscale keeps the detail.

The same plugin hangs the `/image-model` picker on the host command in the chat composer: one searchable list of the deployment's image models, the stored choice marked active, and a pick submitting `/image-model <provider>/<model>`, which is the line that stores it. The rows are the deployment's configured `choices` plus the models a `listedProviders` provider currently serves, read from this client's `media` settings scope and the seam's own catalog. That is the surface an image model is chosen from while Imagine itself has no model control; the choice is the deployment's image-generation setting, so it is shared with `generate_image` rather than private to this page. `/video-model` gets the same picker over the `media-video` settings scope; its rows are that document's `choices` alone, since no listed provider offers video models.

Image generation in chat is rendered at its tool call by `ImageToolView`, registered for `generate_image`, `codex_image_generate`, `codex_image_edit` and `grok_imagine_image`. Each frame carries a round prompt control in its lower-left corner: it names itself on hover and opens the prompt in the connectors skill popup's dialog, title row carrying a one-click copy. The control sits over the spinner while the call runs and stays on the failure frame. Success uses the shared attachment gallery; a failed call keeps the same reserved frame bare, its message behind a round alert control in the frame's upper-left corner carrying the lucide `circle-alert` glyph, which opens it in the prompt's own dialog. A frame is the box its image is shown in, and a running call already frames the shape its own request names — a `WIDTHxHEIGHT` size or a `W:H` aspect ratio — so its placeholder covers exactly the box the image later fills; a request naming no shape (a resolution tier, `auto`, or no size) frames landscape until its image arrives. A call asking for several images reserves one frame each. These calls remain visible with process collapsed, including nested code dispatches; no progress event or separate image store is added. `VideoToolView`, registered for `generate_video`, renders the same frame: a spinner over a frame in the requested aspect ratio while the job runs, then an inline clip under `VideoPlayer`'s own playback chrome, read from `/api/attachment-file` for the clip the result cites, with the frame taking the clip's own shape once its metadata loads. That chrome is the product's own rather than the browser's: a flat white disc carrying the lucide `play` glyph, the elapsed and total readout, a scrubber, a `volume-2`/`volume-x` disc beside its level slider, a save popup opened from a vertical-dots disc whose `download` row saves the clip under its own file name, drawn with the composer's own popup card and cell recipe, and a `maximize-2`/`minimize-2` disc for full screen. Every face is a white surface carrying the product's black glyph, the clip's own events drive them all, full screen is taken on the player element so the chrome stays with the clip, and a playing clip the pointer has left alone clears the bar until the pointer returns or the clip is held. Its prompt control sits in the upper-left corner, clear of the controls, where a failed frame instead carries the alert control, the prompt control returning to the lower-left.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

None, as this package registers no tool, schema, or prompt section, and the starter-prompt text it writes into the composer is the reader's own message, which the conversation owns.

#### KV Cache effect

None; the page sends no request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Only three cards ship example images** — Instagram original, Instagram retouch and Aerial view; the illustrated prompts render title-only until their assets land in `apps/web/public/imagine-prompts/`.
- **A create prompt's pick is not reproducible** — the scene and the grade are drawn when the popup opens, so reopening it, or rerolling, composes a different message; nothing records which pick a reader sent.
- **The aspect choice travels as message text** — the size line is honored as far as the model follows it; nothing pins the size on the generation itself, because the Aeven image providers take a `WIDTHxHEIGHT` size rather than an aspect ratio.
- **A retouch prompt does not require a photo** — `Try it` stays live with nothing staged and the message asks for the photo, so a reader who sends it without one gets that question instead of an image.
- **The picker's rows restate the host's choice list** — this plugin merges the settings choices with the listed providers' catalog because that catalog changes with a subscription's sign-in state; the host re-resolves the same two sources when the submitted line arrives and refuses anything outside them, so a row the host no longer offers surfaces as that command's error.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The starter prompt catalogue carries the dictionary keys, the shipped example, the offered ratios, and whether the prompt edits a supplied photo; the popup composes the message from them, so a new prompt is a catalogue entry plus its dictionary keys and its asset.

</details>
