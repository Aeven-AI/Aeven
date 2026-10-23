---
description: "The video reader: claims recorded and uploaded clips and reports the duration, frame size, codec, container, and size this deployment knows."
kind: "package-reference"
---

# @aeven/document-extract-video

English | [中文](README.zh.md)

## Summary

`@aeven/document-extract-video` registers the provider `video` at priority 10 on `ctx.documentExtract`, so an uploaded or camera-recorded clip (`mp4`, `m4v`, `mov`, `webm`) becomes an admissible file attachment instead of an unsupported type. The reader probes the clip with the host's own `ffprobe` and stores one sentence describing it; frames and sound are never transcribed, so the sentence says exactly that.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount it beside the service: the plugin registers the `video` provider on `ctx.documentExtract`. The composer's file intake then accepts video because `documentExtract.accepted()` includes the provider's formats.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `ffprobePath` | `ffprobe` | Probe executable, resolved through `PATH` unless it names a file |
| `probeTimeoutMs` | `15000` | Wall-clock limit for one probe; a timeout falls back to file facts |

Without a reachable `ffprobe` the reader still claims the formats and reports the container and byte size alone, so a deployment without the binary attaches clips rather than refusing them.

<a id="dev-note"></a>
## Dev Note

No runtime invariant companion is published: the relationship it could assert — that a registered format is also extractable — is already enforced by the registry's own routing, and a companion would restate it.

### Verification

`tests/extract.spec.ts` pins the claim set, the probed sentence, both fallback paths (no binary, unusable answer), a stream naming only its codec, the unrecognized-container label, cancellation, and the fiber's withdrawal of the formats.

<a id="model-experience"></a>
## Model Experience

### A clip as one text line

#### What the model sees

The uploaded file reaches the model as an `<attached_file>` element whose extracted text is one sentence, for example `Video clip "clip-1755000000000.webm": 8.2 s, 720×1280, vp9, WebM, 3.4 MB. The clip is stored with this session; its frames and sound are not transcribed.` The model learns that a clip exists, how long it runs, and its frame size, and the sentence states plainly that the content itself was not read.

#### Token effect

One sentence per clip, bounded by the extraction budget.

#### KV Cache effect

Append-only: the sentence is stored with the attachment, so replay and a later turn cite the same sentence without re-probing.

## Known Limitations and Deferred Work

- **Nothing watches the clip** — no frame and no audio transcription exists, so the model reasons about a clip from its facts alone. A frame-sampling reader is the natural next step, using the same `ffprobe` dependency to choose timestamps.
