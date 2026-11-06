---
description: "ctx.motion renderer for Hosts that run no browser over model-written pages: bundles a composition for the live player and renders no films."
kind: "package-reference"
---

# @aeven/motion-preview

English | [中文](README.zh.md)

## Summary

This provider registers a motion renderer that only bundles. `bundle()` copies a composition folder through `ctx.fs` into a private scratch folder and returns HyperFrames' `bundleToSingleHtml` of it, with the runtime inlined, which the conversation's live player plays. `render()` rejects, so no browser runs a model-written page on the Host. Hosted Web mounts it, because one Host serves many accounts there.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it after [`avn-motion`](../motion/README.md) on a Host that provides `ctx.fs`, and set `render: false` on [`avn-tool-motion`](../tool-motion/README.md) so the model is offered no stills and no `render_motion`. `maxFiles` (default 500) and `maxBytes` (default 64 MiB) bound the folder one bundle reads; a larger folder fails the bundle.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The copy walks the folder with `ctx.fs.listDir` and keeps only regular files and directories whose resolved target lies inside the folder, so a symbolic link a command placed there cannot pull another folder's files into the document. The top-level `renders/` folder, where films are written, is skipped. The bundler then reads only the scratch copy, which is removed after each bundle.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through [`avn-tool-motion`](../tool-motion/README.md), which reports a bundling failure, such as a folder over the bounds, as its error text.

#### KV Cache effect

The renderer adds nothing to a request, so prefix reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No invariant companion** — No invariant companion is published: the renderer holds no state.
- **No MP4 export** — the film's menu downloads the bundled page; an MP4 needs a render inside the account's sandbox, which this renderer does not start.

<a id="dev-note"></a>
### Dev Note

None.
