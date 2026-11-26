---
description: "The ctx.motion Service Definition: one registered renderer turns an HTML animation composition into an MP4 film."
kind: "package-reference"
---

# @aeven/motion

English | [中文](README.zh.md)

## Summary

This Service Definition renders an authored animation composition to an H.264 MP4 through `ctx.motion`. A consumer resolves a request (composition folder, output path, and optional frame rate, quality, still times, still region, and audit times) into a spec, then renders that spec on the one registered renderer and receives the film's path, size, duration, dimensions, encoder, any requested PNG stills, and the findings of a requested audit: measured problems with the film's text, such as a clipped headline or type under the size floor.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it with one renderer, such as [`avn-motion-hyperframes`](../motion-hyperframes/README.md), and a consumer, such as [`avn-tool-motion`](../tool-motion/README.md). `fps` (24, 30, or 60; default 30) and `quality` (`draft`, `standard`, or `high`; default `standard`) fill a request that omits them. Composition and output paths are absolute local paths; confining them to a workspace is the consumer's job. `audit` holds the thresholds findings are judged by: `typeFloorFraction` (default 0.026 of the frame's short side), `readOpacity` (0.5), `minHeldSeconds` (0.5), `minHeldShare` (0.5), `holdBaseSeconds` (0.5), `holdPerWordSeconds` (0.3), and `maxFindings` (20). The type, opacity, and reading-time defaults are the ones HyperFrames' own `check` command uses. A request may carry the calling session's `sandboxPolicy`: a renderer that runs inside the account's sandbox requires it and keeps every path inside its workspace root, and a renderer on the Host's own machine ignores it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`resolve()` applies the defaults and captures the registered renderer; it throws when none is registered. `render()` rejects a spec whose renderer was withdrawn or replaced and runs under both the caller's signal and the registration's lifetime. `bundle()` asks the registered renderer for the composition as one self-contained HTML document, with scene files, the player runtime, images, and fonts inlined, so it plays without its folder; it throws when none is registered. A request with `auditTimes` asks the renderer to measure the film at those times. The renderer adds the audit script (`withMotionAuditScript`) to the bundled document, calls `window.__avnMotionAudit(times)` in a page that plays it, and returns the page's samples; `render()` judges them with `summarizeAudit` under the service's `audit` thresholds, so every renderer yields the same findings. A layout problem is reported only when it holds for `minHeldSeconds` and for `minHeldShare` of the element's time on screen, which leaves out entrances, exits, and scene changes. The script is HyperFrames' layout audit, copied unmodified into [`audit/`](audit/README.md), plus a driver that seeks the film. A second `register()` throws without replacing the first. The registration disposer aborts accepted renders and waits for them to settle.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through [`avn-tool-motion`](../tool-motion/README.md), which owns every schema, skill, and result the model reads.

#### KV Cache effect

The service adds nothing to a request, so prefix reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No invariant companion** — No invariant companion is published: the service holds one registration and no state another observer could contradict.
- **Text only** — the audit judges text: clipping, overflow, overlap, occlusion, size, opacity, reading time, and fonts that did not load. It does not judge alignment, color contrast against a picture, or motion.
- **Local paths only** — a renderer reads the composition from and writes the film to the Host's own filesystem, so a session whose workspace lives in a remote sandbox cannot render.

<a id="dev-note"></a>
### Dev Note

None.
