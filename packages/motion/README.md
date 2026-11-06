---
description: "The motion package group: the ctx.motion film-rendering seam, its HyperFrames renderer, and the render_motion tool with its motion skill."
kind: "package-group"
---

# motion/ — motion films

English | [中文](README.zh.md)

## Summary

The motion group turns an animation the model writes as HTML into an MP4 film. The model authors a [HyperFrames](https://github.com/heygen-com/hyperframes) composition in the session's workspace and `show_motion` shows it: the conversation plays the composition live under the product's clip controls, and the user exports it to an MP4 from the film's own menu. Nothing here generates footage: every frame is drawn by the composition, so text, data, logos, and the user's images move exactly as written. Only the desktop Host mounts the renderer, because it needs a local Chromium and the bundled ffmpeg.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`motion`](motion/README.md) | Owns `ctx.motion`: resolves a render request and runs it on the one registered renderer |
| [`motion-hyperframes`](motion-hyperframes/README.md) | Renders compositions with HyperFrames in Chromium and encodes H.264 through the bundled ffmpeg |
| [`tool-motion`](tool-motion/README.md) | Registers `show_motion`, `render_motion`, and the `motion` skill while a renderer exists |
| [`api-motion`](api-motion/README.md) | Serves the Motion card's live preview, MP4 export, and film bytes |

<a id="related-documentation"></a>
## Related documentation

- [Motion Films subsystem](../../docs/subsystems/motion.md) — the generated `ctx.motion` API reference.
- [Capability seams](../../docs/glossary.md#capability-seam) — the Service Definition, Service Provider, and Consumer roles this group is built from.
- [Bundled ffmpeg](../../.agents/notes/implemented/architecture/2026-10-18-desktop-bundles-ffmpeg.md) — the LGPL-only executables the renderer encodes and probes with.
- [Motion films decision](../../.agents/notes/implemented/feature/2026-11-06-motion-films.md) — why HyperFrames, the encoder per platform, and the desktop-only scope.

<a id="dev-note"></a>
## Dev Note

None.
