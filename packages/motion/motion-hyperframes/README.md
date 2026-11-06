---
description: "HyperFrames renderer for ctx.motion: Chromium frame capture and H.264 MP4 encoding through the bundled LGPL ffmpeg on macOS, Windows, and Linux."
kind: "package-reference"
---

# @aeven/motion-hyperframes

English | [中文](README.zh.md)

## Summary

This provider registers [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache-2.0) as the motion renderer. HyperFrames loads the composition in a headless Chromium, seeks its paused GSAP timelines frame by frame, and encodes the frames with ffmpeg, so every render of the same files is identical. Encoding uses the Aeven-built ffmpeg and ffprobe, which carry no GPL code, so H.264 comes from an encoder each platform provides. Its `bundle()` is HyperFrames' `bundleToSingleHtml` with the runtime inlined.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it after [`avn-motion`](../motion/README.md). `browserCacheDir` is required: it is where a downloaded headless Chromium is kept. The desktop Host sets it under the Aeven home.

| Field | Default | Meaning |
|---|---|---|
| `ffmpegPath`, `ffprobePath` | the bundled `@aeven/ffmpeg-<platform>-<arch>` executables | Encoder and prober; a missing executable is logged at load and fails each render until it is present, while the rest of the Host still starts |
| `browserPath` | an installed Chrome, Chromium, Edge, or Brave, else a downloaded headless shell | Chromium executable for frame capture |
| `fallbackEncoders` | `h264_mf`, `libopenh264` | H.264 encoders tried in order when HyperFrames finds no hardware encoder |
| `intermediateProfile` | `422` | ProRes profile of the intermediate a fallback encoder reads |
| `fallbackBitrate` | `6M` / `12M` / `20M` | Fallback video bitrate for `draft` / `standard` / `high` |
| `stillWidth` | `960` | Width of returned stills in pixels |

Encoders by platform:

- **macOS:** VideoToolbox.
- **Windows:** Media Foundation, through the fallback path.
- **Linux:** VAAPI when a GPU driver serves it; otherwise OpenH264, through the fallback path.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin sets `HYPERFRAMES_FFMPEG_PATH` and `HYPERFRAMES_FFPROBE_PATH` for the Host process once it finds both executables, because HyperFrames reads its executables only from those variables, and restores the previous values on unload.

On the first render it chooses the browser and the encode path and reuses both after they succeed:

- **Browser:** the configured path, else the first installed browser at its platform location, else Chrome for Testing's headless shell at the build the producer's Puppeteer pins, downloaded into `browserCacheDir`.
- **Direct path:** when HyperFrames' own probe finds a hardware encoder, it writes the MP4 with that encoder.
- **Fallback path:** otherwise it renders a ProRes `.mov` into a temporary folder, and the first fallback encoder that encodes a test frame re-encodes it to H.264, copying the AAC audio.

ffprobe then reads the film's duration and size, and ffmpeg takes the requested stills. Renders run one at a time; each already uses every core.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through [`avn-tool-motion`](../tool-motion/README.md), which reports renderer failures, such as a composition HyperFrames rejects or no working encoder, as its error text.

#### KV Cache effect

The renderer writes files and appends nothing to a request, so prefix reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No invariant companion** — No invariant companion is published: the renderer holds only memoized lookups, which no second observer reports.
- **The fallback path encodes twice** — the ProRes intermediate is visually lossless at the default profile, but it needs about 3.5 MB per second of 1080p30 in the temporary folder and adds an encode pass.
- **A Windows N edition without the Media Feature Pack cannot render** — ffmpeg loads `mfplat.dll` only when the Media Foundation encoder opens, so it starts, but finds no encoder.
- **No NVENC, QSV, or AMF** — the bundled ffmpeg compiles no vendor GPU encoders, so Windows always takes the fallback path.

<a id="dev-note"></a>
### Dev Note

None.
