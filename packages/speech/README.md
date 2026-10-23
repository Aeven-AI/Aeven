---
description: "The speech package group: the ctx.speechToText recognizer registry, the speech Remote the browser calls, and the local Whisper provider."
kind: "package-group"
---

# speech/ — speech to text

English | [中文](README.zh.md)

## Summary

The speech group turns a recording made in the browser into text on the machine Aeven runs on, without sending the audio to a vendor. `ctx.speechToText` holds the named recognizers, resolves one before a call, and runs exactly that one, so no fallback sends audio elsewhere. Three packages split the family: the Service Definition that owns selection, readiness, and cancellation; the `speech` Remote that connects a browser recording to it; and the local Whisper provider that runs whisper.cpp in a managed worker. Nothing here is model-facing: a transcription never activates or submits to an agent.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

The Service Definition owns selection and cancellation; the other two packages connect a browser recording to it and register the recognizer that answers.

| Package | Role |
|---|---|
| [`speech-to-text/`](speech-to-text/README.md) | Owns `ctx.speechToText`: named recognizer registration, explicit resolve-then-transcribe, readiness, and cancellation |
| [`api-speech-to-text/`](api-speech-to-text/README.md) | Exposes the `speech` Remote to the browser: provider discovery, preparation, and one complete-recording transcription |
| [`speech-to-text-whisper/`](speech-to-text-whisper/README.md) | Registers the local Whisper recognizer: a managed whisper.cpp worker, models verified on demand, and the preparation state the surfaces show |

<a id="related-documentation"></a>
## Related documentation

- [Speech to text subsystem](../../docs/subsystems/speech.md) — the `ctx.speechToText` and `ctx.speechController` operations, provider readiness, and selection.
- [Generated configuration catalog](../../docs/config-catalog.md#aevenspeech-to-text-whisper) — the model origin, idle timeout, and pending bound the local provider accepts.
- [Capability seams](../../docs/glossary.md#capability-seam) — the Service Definition, Service Provider, and Consumer roles this group is built from.

<a id="dev-note"></a>
## Dev Note

None.
