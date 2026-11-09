---
description: "The show_motion, review_motion, and render_motion tools and the motion skill over ctx.motion: show a HyperFrames composition folder as a live film, review it from stills only the model sees, and render it to an MP4 on request."
kind: "package-reference"
---

# @aeven/tool-motion

English | [中文](README.zh.md)

## Summary

`avn-tool-motion` registers `show_motion`, `review_motion`, `render_motion`, and the `motion` skill. The skill teaches the model to plan a film, write a [HyperFrames](https://github.com/heygen-com/hyperframes) composition in the workspace, review it, revise, and show each finished round. `show_motion` renders nothing: it hands the composition folder to the Imagine Motion card, which plays it live and exports it to MP4 on the user's request, and stores the folder bundled into one HTML document as a file attachment, so the account's other devices, which lack the folder, play the same film. `review_motion` renders a draft to `renders/.review.mp4` inside the folder, replaced by each review, and returns stills to the model alone, at given film times, spread through one scene's window, or spread through the whole film; the user's film stays as it is. Both read `index.html` first and refuse a composition that cannot render as written: no root length, a scene file that does not exist, or a scene running past the film. `show_motion` also refuses a film shorter than `shrinkRatio` of the length last shown from the same folder in the session, unless the call passes `force`. `render_motion` renders the folder to an MP4 inside it and stores the film as a conversation file attachment, for when the user asks the model for the file. All wait for `ctx.motion`, so a composition without a renderer shows none of them.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it per session beside a Host composition that provides `ctx.tools`, `ctx.attachments`, and `ctx.fs`. The tools and skill register only while `ctx.motion` exists, so a composition without a renderer activates the plugin with nothing registered; `ctx.skills` is optional and adds the skill, including `/motion`. `maxStills` (default 8, at most 16) caps the stills one `render_motion` call may request, `maxReviewStills` (default 12, at most 16) those of one review, and `shrinkRatio` (default 0.5) sets how much shorter than the last shown film a re-show may be before it needs `force`. Every render carries the session's sandbox policy, which a renderer confined to the account's sandbox, such as [`avn-motion-sandbox`](../motion-sandbox/README.md), requires.

Both tools take a required `composition`. It resolves through `ctx.fs` the way the filesystem tools resolve paths: against the session's working directory, or, for a chat without one, against the sandbox policy's workspace root. `output` defaults to `renders/<folder>.mp4` inside the composition folder. `show_motion` takes an optional `force`; `review_motion` takes optional `times`, or `scene` and `stills`; `render_motion` takes optional `fps`, `quality`, and `stills`. Both paths must stay inside the session's workspace root, or the policy's when the session has none.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The tool validates its arguments, resolves the request through `ctx.motion.resolve()`, and renders it. It stores the MP4 with `saveFile` and each still with `saveImage`. A store refusal, such as the attachment size limit, keeps the film on disk and reports the refusal instead of failing the call. The result reuses `fileBlockRef` and `imageBlockRef` from [`avn-tool-media`](../../media/tool-media/README.md) to restore attachment brands. The Imagine client lists `render_motion` with its video tools, so the same card plays the film.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The [`render_motion` schema](../../../docs/tool-catalog.md#aeventool-motion): a required `composition` folder and optional `output`, `fps`, `quality`, and `stills`. The description states the folder layout, that rendering takes about as long as the film plays, and that the film is shown to the user without restatement.

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged.

### Skill

#### What the model sees

The skill catalog lists `motion` with its description. Loading it returns the planning, composition, craft, and render-and-review instructions.

#### Token effect

The catalog line costs a few dozen tokens per request; the loaded body costs about 1,800 tokens once per load.

#### KV Cache effect

The catalog line is stable while the skill is registered. A loaded body appends to history.

### Tool-call history and result

#### What the model sees

One line names the relative MP4 path, the duration, and the size. The line says the film is already displayed, or why it could not be attached. A file block for the film and one image block per still follow.

#### Token effect

The film is a file block that the model reads as its stored text. Each still costs visual tokens in every later request that carries it, until compaction or request-image offloading replaces it.

#### KV Cache effect

Append-only; does not invalidate earlier prefix reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No invariant companion** — No invariant companion is published: the tool owns no durable state; storage and rendering are owned by `ctx.attachments` and `ctx.motion`.
- **A render holds the call** — the call stays open for the whole render, with no progress shown at the call.

<a id="dev-note"></a>
### Dev Note

None.
