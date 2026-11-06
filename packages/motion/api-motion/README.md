---
description: "Browser routes behind the Motion card: the live preview bundle of a composition folder, the user's MP4 export, and the exported film's bytes."
kind: "package-reference"
---

# @aeven/api-motion

English | [中文](README.zh.md)

## Summary

`avn-api-motion` registers the three authenticated Host routes the Motion card calls: `GET /api/motion/preview?dir=` returns a composition folder bundled into one HTML document, `POST /api/motion/export` renders the folder through `ctx.motion` into `renders/<folder>.mp4`, and `GET /api/motion/film?path=` streams that MP4 with byte ranges so the card can seek. A fourth route, `GET /api/motion/replay?sessionId=&callId=`, rebuilds the composition a `show_motion` call showed from the caller's own conversation log, the files its successful `write` and `edit` calls produced inside the folder, and bundles it, so a film shown on another of the account's devices plays where the folder is absent. The three folder routes register only while `ctx.motion` exists and the replay route only while `ctx.sessionController` exists; the desktop Host mounts it beside the renderer, and hosted Web mounts it without one, so hosted serves replays alone.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it on a Host that provides `ctx.connection` and `ctx.motion`. `exportQuality` (`draft`, `standard`, or `high`; default `high`) sets the quality of a film the user exports. Each route reads an absolute path from the request, like `/api/file`; the connection service authenticates the request before the route runs, and the account cookie admits the two GET routes so the browser can load and download without a bearer.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The preview route returns `ctx.motion.bundle()`, so scene files, the runtime, images, and fonts arrive in one document. The card loads that document as `srcdoc` in a frame without `allow-same-origin`, where no relative URL could resolve. Every response carries `Content-Security-Policy: sandbox`, so a route opened directly in a tab runs nothing on the app's origin. The export route answers with the film's path, size, duration, and dimensions as JSON, or a `{ message }` body with status 500 when the render fails. The film route accepts only `.mp4` paths and honours one `Range: bytes=` span.

-----

<a id="model-experience"></a>
## Model Experience

None, as the routes serve the browser and nothing they return reaches a model request.

#### KV Cache effect

No tokens pass through these routes, so prefix reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Replays see only logged file writes** — a composition file written by a command, an image or font asset, or a file that existed before the conversation is absent from a replay, and a Windows folder path does not resolve on a POSIX Host.
- **No invariant companion** — No invariant companion is published: the routes hold no state.
- **Large media is not inlined** — the bundle inlines images and fonts up to HyperFrames' per-asset size ceiling; video and audio a composition references by relative path do not load in the preview, though the export renders them.
- **Preview scripts load from the network** — GSAP and any other library a composition names by URL load from their CDN inside the preview frame.

<a id="dev-note"></a>
### Dev Note

None.
