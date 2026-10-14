---
description: "Local Whisper transcription on the Host: a managed whisper.cpp worker, verified on-demand models, and the preparation state the speech surfaces show."
kind: "package-reference"
---

# @aeven/speech-to-text-whisper

English | [中文](README.zh.md)

## Summary

`@aeven/speech-to-text-whisper` registers the local recognizer on `ctx.speechToText` under `providerId` (default `whisper-local`). whisper.cpp runs in a managed subprocess worker that takes one decoded WAV at a time and answers with its text. On activation the plugin inspects the on-disk caches and reports readiness without downloading or loading a model; a preparation downloads the model and the Silero VAD file from a configured origin, verifies each by SHA-256, and starts the worker. One serial worker serves every recording, `maxPending` bounds how many may wait, and an idle worker is stopped after `idleTimeoutMs`.

## Use this package

Mount it in a Host composition beside a `speechToText` slot. `dataRoot` is the absolute directory holding verified models; `modelPath`, `vadModelPath`, and `workerPath` name existing files instead and otherwise default to the downloaded model and the platform package's prebuilt worker. `modelOrigins` lists the Hugging Face-compatible origins compared before each download, and setting `modelOrigin` pins one origin and drops the public fallback. The package's own specs cover the download and integrity path, the origin race, and the download diagnostics.

## Model Experience

### Local transcription

#### What the model sees

Nothing from this package: it registers no tool and no prompt text. A consumer that asks `ctx.speechToText` for a transcript owns whatever text reaches the model, and the preparation state (`phase`, `steps`, `download`) reaches product surfaces through the registry.

#### Token effect

None of its own; a transcript costs tokens only in the result the consumer builds.

#### KV Cache effect

None; the package contributes no request-time text.

## Known Limitations and Deferred Work

- **No invariant companion** — No runtime invariant companion is published because the download, integrity, and origin-race relations are asserted by this package's own specs, and the rest of its state is the preparation phase it publishes into `ctx.speechToText`, which a companion could only read back from the service it observes.
- **A first preparation needs a reachable origin** — with `modelPath` and `vadModelPath` omitted, the model and VAD files are downloaded at prepare time, so an offline deployment must pre-place both files.
