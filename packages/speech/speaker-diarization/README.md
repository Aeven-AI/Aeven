---
description: "Local speaker diarization: splits a recording into stretches of one voice each and embeds every stretch, with on-demand verified pyannote and WeSpeaker models through sherpa-onnx."
kind: "package-reference"
---

# @aeven/speaker-diarization

English | [中文](README.zh.md)

## Summary

`ctx.speakerDiarization` tells voices apart for the Recorder. `segment` splits one recording into stretches that tile it, one voice each, and gives every stretch long enough to trust a unit-length voice embedding, so a caller can recognize the same voice across the recordings of one meeting. The models — pyannote segmentation 3.0 and a WeSpeaker ResNet34 voice embedding, 32.5 MB together — download on `prepare` into `dataRoot`, size- and SHA-256-verified against `runtime/assets.json`. Inference runs through the sherpa-onnx Node-API addon in one worker thread, so it never blocks the Host's event loop. A Host with no sherpa-onnx build for its platform reports `unavailable` instead of failing.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose it with an absolute `dataRoot`. Activation inspects the cache without downloading; `snapshot` and `follow` report `unavailable`, `unprepared` (with the total download size), `checking`, `downloading` (bytes across both files), `ready`, or `failed`. `prepare` downloads and verifies the missing files, joining a running preparation. `segment(samples, signal)` takes 16 kHz mono samples in [-1, 1] and returns `{ start, end, embedding? }` stretches in order; it refuses before the models are ready. `clusteringThreshold` is the cosine distance under which two stretches of one recording join one speaker, `minDurationOn` and `minDurationOff` shape the stretches, `minEmbeddingSeconds` merges shorter stretches into a neighbour, and `threads` sets each model's CPU threads.

-----

<a id="further-exploration"></a>
## Further Exploration

- [api-speech-to-text](../api-speech-to-text/README.md) — the `speech` Remote methods that expose this service to the browser.
- [ui-sidebar-meeting](../../client/ui-sidebar-meeting/README.md) — the Recorder, which matches these embeddings across a meeting.

-----

<a id="model-experience"></a>
## Model Experience

None, as it splits recordings by voice for the Recorder through the speech Remote and registers no prompt, tool, or session event.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No invariant companion** — No invariant companion is published because the service owns one state value and one worker, and every observer reads that same state through `snapshot` or `follow`, so no second observation can diverge from it.
- **Windows on ARM has no runtime** — sherpa-onnx publishes no build for it, so the service reports `unavailable` there and the Recorder labels no speakers.
- **Tuned on one panel** — `clusteringThreshold` 0.3 kept a four-person panel apart where sherpa-onnx's 0.5 merged two speakers; other rooms may want a different value.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The worker runs from source with `eval: true` and loads the addon from the absolute path the main thread resolves, so the bundled Host needs no second entry file.

</details>
