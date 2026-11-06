---
description: "The ctx.motion Service Definition: one registered renderer turns an HTML animation composition into an MP4 film."
kind: "package-reference"
---

# @aeven/motion

English | [中文](README.zh.md)

## Summary

This Service Definition renders an authored animation composition to an H.264 MP4 through `ctx.motion`. A consumer resolves a request (composition folder, output path, optional frame rate, quality, and still count) into a spec, then renders that spec on the one registered renderer and receives the film's path, size, duration, dimensions, encoder, and any requested PNG stills.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it with one renderer, such as [`avn-motion-hyperframes`](../motion-hyperframes/README.md), and a consumer, such as [`avn-tool-motion`](../tool-motion/README.md). `fps` (24, 30, or 60; default 30) and `quality` (`draft`, `standard`, or `high`; default `standard`) fill a request that omits them. Composition and output paths are absolute local paths; confining them to a workspace is the consumer's job.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`resolve()` applies the defaults and captures the registered renderer; it throws when none is registered. `render()` rejects a spec whose renderer was withdrawn or replaced and runs under both the caller's signal and the registration's lifetime. A second `register()` throws without replacing the first. The registration disposer aborts accepted renders and waits for them to settle.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through [`avn-tool-motion`](../tool-motion/README.md), which owns every schema, skill, and result the model reads.

#### KV Cache effect

The service adds nothing to a request, so prefix reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No invariant companion** — No invariant companion is published: the service holds one registration and no state another observer could contradict.
- **Local paths only** — a renderer reads the composition from and writes the film to the Host's own filesystem, so a session whose workspace lives in a remote sandbox cannot render.

<a id="dev-note"></a>
### Dev Note

None.
