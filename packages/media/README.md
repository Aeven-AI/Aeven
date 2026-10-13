---
description: "The media package group: the ctx.media generated-image and generated-video seam, and the Aeven, DeepInfra, OpenRouter, and pi-ai providers that serve it."
kind: "package-group"
---

# media/ — generated images and video

English | [中文](README.zh.md)

## Summary

The media group lets a composition generate images and video clips from a prompt through one `ctx.media` service, so a caller asks for a picture or a clip the same way whichever vendor answers. Mount the seam plus one or more provider packages, and a caller selects a provider by name and passes the provider's own model id verbatim. Images return their bytes directly; video is always a job a caller starts, polls, and then fetches. The seam registers no tool and nothing model-facing — a consumer owns whatever a model sees.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

The seam package owns the service and the provider registries; each provider package registers one vendor's image or video capability into it.

| Package | Role |
|---|---|
| [`media`](media/README.md) | Owns `ctx.media` and the image and video provider registries every provider registers into |
| [`media-aeven`](media-aeven/README.md) | Serves Aeven's two image models from the Aeven gateway over the signed-in session |
| [`media-deepinfra`](media-deepinfra/README.md) | Serves images and video from DeepInfra's OpenAI-compatible endpoints |
| [`media-openrouter`](media-openrouter/README.md) | Serves video from OpenRouter through submit, poll, and content retrieval |
| [`media-pi-ai`](media-pi-ai/README.md) | Serves images by registering pi-ai's own images registry as providers |

<a id="related-documentation"></a>
## Related documentation

- [Generated Media subsystem](../../docs/subsystems/media.md) — the seam's vocabulary, the image and video request shapes, and why one capability covers both media.
- [Capability seams](../../docs/glossary.md#capability-seam) — the Service Definition, Service Provider, and Consumer roles this group is built from.
- [Generated configuration catalog](../../docs/config-catalog.md) — every accepted config field for the seam and its providers.

<a id="dev-note"></a>
## Dev Note

None.
