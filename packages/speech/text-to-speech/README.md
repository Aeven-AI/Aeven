---
description: "Named speech synthesis providers and language-to-voice resolution."
kind: "package-reference"
---

# @aeven/text-to-speech

English | [中文](README.zh.md)

## Summary

This Service Definition turns text into spoken audio through `ctx.textToSpeech`. Consumers resolve a request (text plus a language or an exact voice) before execution; providers register their own voices and transport.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load through the [web-app bundle](../../bundle/web-app/README.md), or compose the service with a provider and a consumer. `voiceByLanguage` pins one voice id per primary language subtag (`en`, `nl`, `es`, `zh`); a language it does not pin resolves through the registered catalogue instead — the language's home region first, then any voice of that language, then a multilingual voice. A missing or duplicate provider, or a voice id two providers both claim, fails at registration.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`resolve()` maps the request onto one registered voice and captures its provider; `synthesize()` rejects a withdrawn or replaced registration and runs under both the caller's signal and the registration's lifetime. A registration disposer closes admission, aborts accepted requests, and joins provider settlement; providers return encoded audio in their own container, and nothing here re-encodes or falls back to another provider.

No runtime invariant companion is published: the registry is the only source of roster and mapping observations.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Speech synthesis subsystem](../../../docs/subsystems/speech.md)

-----

<a id="dev-note"></a>
## Dev Note

The default voice for a language is female because the rosters ship more male voices than female ones at several rungs, and a plain first-match resolution lands on a male voice: the Edge roster lists a male Japanese voice ahead of `ja-JP-NanamiNeural` and a Cantonese voice for the `zh` family. Resolution therefore prefers a female voice at each rung — the language's dominant region, the exact language, the family, then any multilingual voice — and falls back to a male voice only where the provider has no female voice for that language. `dominantLocale()` counts the roster instead of trusting the first listed locale, which is what keeps `zh` on Mandarin.

The catalogue carries the timbre the provider reported rather than inferring it from a voice id: names such as `zh-CN-XiaoxiaoNeural` do not encode gender, and a configured row that omits `gender` keeps whatever discovery reported for the same id.

No runtime invariant companion is published: the registry is the only source of roster and mapping observations.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `avn-tool-read-aloud` and the Web reader that call it.

#### KV Cache effect

Synthesis renders text the model already produced and adds no token to a request, so prefix reuse is unaffected.

## Known Limitations and Deferred Work

- The service has no voice-preference persistence; Surfaces currently read the composition's mapping only. Rate, pitch, and per-request prosody are not part of the request.
