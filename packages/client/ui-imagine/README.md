---
description: "The Imagine surface: the /i/<id> page that takes the center column in place of the chat."
kind: "package-reference"
---
# @aeven/client-ui-imagine

English | [中文](README.zh.md)

## Summary

Imagine is a page of its own at `/i/<id>`, separate from chat Sessions. The plugin claims the `/i` path root on the layout's surface router (`ctx.layout.surfaces`) and contributes its page to the `surface` slot, so while the address is under `/i` the center column shows Imagine instead of the chat, and the chat's details and right sidebar columns stay closed. A bare `/i`, or an id that is not a UUID, is rewritten in place to a fresh `/i/<uuid>`. The id names no Session.

The start page is the chat's New Session screen: the product name and the reader's greeting (the chat's `HeroShell`), over a composer card with the chat hero composer's geometry. The card keeps what the reader types; its add and send controls stay disabled until Imagine can generate.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

None, as nothing on the Imagine page reaches a model request.

#### KV Cache effect

None; the page sends no request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No generation yet** — the composer card accepts text but sends nothing; the add and send controls are disabled.
- **The composer card restates the chat card's CSS** — its values follow ui-conversation's hero composer, so a change there has to be carried here until the two composers share one component.
- **No navigation entry** — the sidebar's Imagine row does not link here yet; the page is reached by its address.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
