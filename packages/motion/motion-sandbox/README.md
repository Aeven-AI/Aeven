---
description: "ctx.motion renderer for a Host that runs model-written pages only inside the calling account's sandbox: bundles compositions for the live player and renders films through the sandbox's render-motion."
kind: "package-reference"
---

# @aeven/motion-sandbox

English | [中文](README.zh.md)

## Summary

This provider registers the motion renderer hosted Web uses, where one Host serves many accounts and no browser may run a model-written page outside an account's jail. `bundle()` copies a composition folder through `ctx.fs` into a private scratch folder and returns HyperFrames' `bundleToSingleHtml` of it, with the runtime inlined, which the conversation's live player plays. `render()` pipes that document into the sandbox's `render-motion` command under the calling session's sandbox policy; the command steps the composition's own player frame by frame into an H.264 MP4 inside the account's folder and returns the film's facts and the requested stills.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it after [`avn-motion`](../motion/README.md) on a Host that provides `ctx.fs` and a sandboxing `ctx.shell`, such as [`avn-sandbox-jail`](../../sandbox/sandbox-jail/README.md) with its `render-motion` installed. Every render request must carry the calling session's sandbox policy, which [`avn-tool-motion`](../tool-motion/README.md) and [`avn-api-motion`](../api-motion/README.md) supply; a request without one fails.

| Field | Default | Meaning |
|---|---|---|
| `maxFiles` | `500` | Most files one composition folder may hold; a larger folder fails the bundle |
| `maxBytes` | `64 MiB` | Most bytes the folder's files may total |
| `command` | `render-motion` | The sandbox command that renders a page |
| `timeoutMs` | `600000` | How long one render may run |
| `resultMaxBytes` | `32 MiB` | Most bytes of the command's JSON result, which carries the stills |
| `crf` | `30` / `23` / `18` | H.264 constant rate factor for `draft` / `standard` / `high` |
| `stillWidth` | `960` | Pixel width of returned stills |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The copy walks the folder with `ctx.fs.listDir` and keeps only regular files and directories whose resolved target lies inside the folder, so a symbolic link a command placed there cannot pull another folder's files into the document. The top-level `renders/` folder, where films are written, is skipped. A render first requires the composition folder and the output path to resolve inside the policy's workspace root, then runs `render-motion - <out.mp4> --json` with the bundle on stdin, so the page never touches the account's folder; the command's last stdout line is its JSON result. The film's size comes from `ctx.fs.stat`, and the encoder is the sandbox's libx264.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through [`avn-tool-motion`](../tool-motion/README.md), which reports a bundling or render failure, such as a folder over the bounds or a composition that never reports ready, as its error text.

#### KV Cache effect

The renderer adds nothing to a request, so prefix reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No invariant companion** — No invariant companion is published: the renderer holds no state.
- **The sandbox image must carry the current `render-motion`** — `host/install-motion.sh` installs it; an older copy without `-` and `--json` fails every render.

<a id="dev-note"></a>
### Dev Note

None.
