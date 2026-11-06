# Agent Note: Motion films rendered from HTML compositions

Status: implemented

English | [中文](2026-11-06-motion-films.zh.md)

## Problem

People ask Aeven for animated explainers, launch videos, animated charts, and title cards. Generated video models cannot hold exact text, numbers, or a brand's own logo still, and they cost per clip. The catalog's OpenDesign motion skills already teach the craft, but they name OpenDesign's own render daemon, which Aeven does not run, so a model following them in Aeven produced no film.

## Decision

The [`motion/`](../../../../packages/motion/README.md) group renders a composition the model writes in the workspace into an MP4 the conversation plays:

- **`@aeven/motion`** owns `ctx.motion`: `resolve()` then `render()` on the one registered renderer.
- **`@aeven/motion-hyperframes`** renders with HyperFrames (Apache-2.0). HyperFrames seeks paused GSAP timelines frame by frame in a headless Chromium, so a render is deterministic.
- **`@aeven/tool-motion`** registers `render_motion` and a runtime `motion` skill. The skill teaches the composition rules and an author, render, review loop; draft renders return stills the model inspects before the delivery render.

HyperFrames was chosen over Remotion and over an Aeven-written capture loop. Its composition format is plain HTML with GSAP, which models already write well. Its renderer is an npm package (`@hyperframes/producer`) that runs in-process with an explicit browser path. Remotion's licence restricts commercial use by larger companies.

The film is previewed live, not rendered on every revision. `show_motion` hands the composition folder to the Imagine Motion card. `@aeven/api-motion` bundles the folder into one document with HyperFrames' `bundleToSingleHtml`, and the card plays it in the HyperFrames player under the same `MediaPlayer` chrome a generated clip uses; the player's frame drops `allow-same-origin`, so model-written scripts run in an opaque origin, apart from the authenticated app. The save menu's row exports: the Host renders the folder at high quality into `renders/<folder>.mp4` and the browser downloads it. `render_motion` remains for when the user asks the model for the file, and the model's own review uses stills from a throwaway draft render.

Only the desktop Host mounts the service, the renderer, and the routes: they need a local Chromium, the bundled ffmpeg, and a workspace on the Host's own disk. The session-side tool waits for `ctx.motion`, so the shared `aeven` preset carries it and hosted sessions never see it.

### Bundled ffmpeg changes

The [bundled ffmpeg](../architecture/2026-10-18-desktop-bundles-ffmpeg.md) carries no GPL code, so it has no libx264, which HyperFrames uses by default. Four build changes make the H.264 render work on every desktop platform:

- **`lavfi` input.** HyperFrames tests the hardware encoder with a `-f lavfi` source and mixes silent audio from one. The build enables `lavfi` as the only input device and still excludes capture devices.
- **`ffprobe` shipped.** HyperFrames validates every encoded file and inspects composition media with it. This reverses the bundling note's choice to ship ffmpeg alone, for a cost of about 21 MB installed on macOS.
- **Media Foundation on Windows.** ffmpeg 9 loads `mfplat.dll` only when the encoder opens, so `ffmpeg.exe` still starts on N editions. This reverses the bundling note's reason for leaving it off.
- **OpenH264 on Linux.** OpenH264 2.6.0 (BSD-2-Clause) is built statically from pinned source and covers Linux machines without a VAAPI driver.

HyperFrames writes an MP4 directly only with the hardware encoders it knows. With Media Foundation or OpenH264, the renderer writes a ProRes 4:2:2 intermediate and re-encodes it with the first encoder that encodes a test frame. HyperFrames needs no patch for this.

## Alternatives considered

**Install the OpenDesign daemon or the HyperFrames CLI.** These are separate processes with their own telemetry and project model. The producer library gives the same renders inside the Host.

**Generated-video models.** They already exist as `generate_video`; they serve a different request and cannot draw exact text or data.

**Ship libx264.** It is GPL and would change the licence of the bundled executable.

**Patch HyperFrames to name `h264_mf` and `libopenh264`.** It would avoid the second encode, but a patch to its encoder argument tables would need re-applying on every upgrade.

## Consequences

The desktop installer grows by the ffprobe executable and the HyperFrames producer with its dependencies. On macOS and Linux, a machine without an installed Chromium downloads Chrome for Testing's headless shell on the first render; Linux arm64 has no such build and needs an installed Chromium. OpenH264 compiled from source carries no Cisco patent licence; Aeven relies on the AVC pool's royalty-free tier for encoders. Windows N editions need the Media Feature Pack to render. The renderer runs one film at a time in the Host process.

## Verification

A render through `ctx.motion` on macOS arm64 writes a 20 s 1080p30 H.264 MP4 through VideoToolbox in about 15 s, with stills. HyperFrames writes the ProRes 4:2:2 intermediate with the bundled macOS ffmpeg. The linux-arm64 build compiles OpenH264 and VAAPI into ffmpeg, with ffprobe beside it; it adds `libstdc++` to the executable's shared libraries. On a VM without a VAAPI device, the probe selects `libopenh264` and re-encodes a ProRes intermediate with AAC audio into a Constrained Baseline H.264 MP4. The Windows targets build only on their CI runners.
