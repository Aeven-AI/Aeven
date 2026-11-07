---
description: "The video reader: claims recorded and uploaded clips and reports the duration, frame size, codec, container, and size this deployment knows."
kind: "package-reference"
---

# @aeven/document-extract-video

English | [中文](README.zh.md)

## Summary

`@aeven/document-extract-video` registers the provider `video` at priority 10 on `ctx.documentExtract`, so an uploaded or camera-recorded clip (`mp4`, `m4v`, `mov`, `webm`, `mp3`) becomes an admissible file attachment instead of an unsupported type. MP3 uploads use the audio stream and report audio metadata. The reader probes the clip with the host's own `ffprobe` and stores one sentence describing it. When the deployment mounts `ctx.speechToText` and the user's voice input is on, it also decodes the clip's sound with `ffmpeg` and transcribes the first `transcribeMaxSeconds` with the selected speech provider, appending the transcript, or stating that no speech was recognized, as with music; otherwise the sentence says the sound is not transcribed. Frames are never described.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount it beside the service: the plugin registers the `video` provider on `ctx.documentExtract`. The composer's file intake then accepts video and MP3 because `documentExtract.accepted()` includes the provider's formats.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `ffprobePath` | `ffprobe` | Probe executable, resolved through `PATH` unless it names a file |
| `probeTimeoutMs` | `15000` | Wall-clock limit for one probe; a timeout falls back to file facts |
| `probeDirectory` | OS temp directory | Directory each clip is written to for the probe |
| `probeRunner` | none | Argv the probe and the sound decoder run under, such as a bubblewrap jail that sees only `/usr` and `probeDirectory`; they start through `ctx.subprocess` when one is mounted |
| `ffmpegPath` | `ffmpeg` | Decoder that turns a clip's sound into 16 kHz mono WAV for transcription, resolved through `PATH` unless it names a file |
| `transcribeMaxSeconds` | `600` | Seconds of sound transcribed from the start of a clip; `0` turns transcription off |
| `decodeTimeoutMs` | `60000` | Wall-clock limit for decoding one clip's sound; a timeout describes the clip without a transcript |

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

The uploaded file reaches the model as an `<attached_file>` element whose extracted text is one sentence, for example `Video clip "clip-1755000000000.webm": 8.2 s, 720×1280, vp9, WebM, 3.4 MB. The clip is stored with this session; its frames and sound are not transcribed.` The model learns that a clip exists, how long it runs, and its frame size. With transcription, the text continues with `Transcript of its sound:` and the recognized words, or reads `No speech was recognized in its sound.`; a transcript adds its words to the attachment's tokens.

#### Token effect

One sentence per clip, bounded by the extraction budget.

#### KV Cache effect

Append-only: the sentence is stored with the attachment, so replay and a later turn cite the same sentence without re-probing.

## Known Limitations and Deferred Work

- **Nothing watches the frames** — only the sound is transcribed, so the model reasons about a clip's picture from its facts alone. A frame-sampling reader is the natural next step, using the same `ffprobe` dependency to choose timestamps. Sound past `transcribeMaxSeconds` is not transcribed.
