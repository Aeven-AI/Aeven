---
description: "The Imagine surface: the /i/<id> page that takes the center column in place of the chat, and the /image-model picker."
kind: "package-reference"
---
# @aeven/client-ui-imagine

English | [中文](README.zh.md)

## Summary

Imagine is a page of its own at `/i/<id>`, separate from chat Sessions. The plugin claims the `/i` path root on the layout's surface router (`ctx.layout.surfaces`) and contributes its page to the `surface` slot, so while the address is under `/i` the center column shows Imagine instead of the chat, and the chat's details and right sidebar columns stay closed. A bare `/i`, or an id that is not a UUID, is rewritten in place to a fresh `/i/<uuid>`. The id names no Session.

The start page is the chat's New Session screen: the product name and the reader's greeting (the chat's `HeroShell`), over a composer card with the chat hero composer's geometry. The card keeps what the reader types; its add and send controls stay disabled until Imagine can generate.

The same plugin hangs the `/image-model` picker on the host command in the chat composer: one searchable list of the deployment's image models, the stored choice marked active, and a pick submitting `/image-model <provider>/<model>`, which is the line that stores it. The rows are the deployment's configured `choices` plus the models a `listedProviders` provider currently serves, read from this client's `media` settings scope and the seam's own catalog. That is the surface an image model is chosen from while Imagine itself has no model control; the choice is the deployment's image-generation setting, so it is shared with `generate_image` rather than private to this page.

Image generation in chat is rendered at its tool call by `ImageToolView`, registered for `generate_image`, `codex_image_generate`, `codex_image_edit` and `grok_imagine_image`. The running view shows the prompt, spinner and elapsed seconds; success uses the shared attachment gallery and failure keeps an error in the same reserved frame. A lone image reserves 240×240 px across generation, attachment loading and settlement. Explicit larger image counts reserve additional rows. These calls remain visible with process collapsed, including nested code dispatches; no progress event or separate image store is added.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

None, as nothing on the Imagine page or in its picker reaches a model request: the picker stores a settings choice and leaves every generation to `generate_image`.

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
