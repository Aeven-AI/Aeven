---
description: "Microsoft Edge read-aloud voices for the speech synthesis service."
kind: "package-reference"
---

# @aeven/text-to-speech-edge

## Summary

This provider speaks through Microsoft's Edge read-aloud service, one WebSocket per voice. At startup it asks Edge for every voice in the configured locales, so the catalogue follows the service instead of a restated list, and the configured voices join it as the entries a deployment guarantees.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Load beside [`@aeven/text-to-speech`](../text-to-speech/README.md). `voices` lists the voice ids this deployment guarantees with their display name and primary language; the synthesis mapping references those ids. `locales` names the Edge locales whose voices join the catalogue at startup, and an empty list takes every locale Edge publishes; an unreachable voice service leaves the configured list as the whole catalogue. `timeoutMs` bounds one request.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The first request for a voice opens and configures one `msedge-tts` client for that voice; later requests reuse it, so consecutive sentences do not pay the handshake again. Cancellation rejects the pending synthesis and closes that voice's client, which the next request reopens. Disposal closes every open client.

Audio is 24 kHz mono MP3, which the browser decodes with `decodeAudioData`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Speech synthesis subsystem](../../../docs/subsystems/speech.md)

-----

<a id="model-experience"></a>
## Model Experience

None. The provider returns audio bytes for text the model already produced.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

Synthesis requires outbound network access to Microsoft's service; there is no offline provider with comparable voice quality yet. The provided `msedge-tts` package is an unofficial client of that service, so endpoint changes are an upstream risk.
