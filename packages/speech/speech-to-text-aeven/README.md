---
description: "Aeven's cloud speech recognition provider: transcription through the API's /transcribe route, using each signed-in user's own Aeven session."
kind: "package-reference"
---

# @aeven/speech-to-text-aeven

English | [中文](README.zh.md)

## Summary

`@aeven/speech-to-text-aeven` is a provider for the speech-to-text capability that sends each recording to Aeven's API and returns its transcript. The request carries the Aeven session of the person dictating, so a Host serving several accounts never bills or attributes one person's speech to another, and the Host itself loads no recognizer model. Choose it wherever a deployment can reach the Aeven API; local recognition is a different provider.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The bundle row names `providerId`, the API origin, the credential reference holding the signed-in user's session, the largest recording it will send (`maxAudioBytes`), and the deadline for one request. Consumers choose the provider by id; a recording over the bound is refused before it is uploaded, and a request that misses its deadline fails rather than half-transcribing.

## Understand the implementation

The provider resolves the caller's Aeven session through the credentials service, posts the recording to the API's `/transcribe` route, and maps the response to the capability's `Transcript`. Refusals and deadlines surface as the provider's own errors; nothing is cached or retried behind the caller's back.

## Further Exploration

- [Speech-to-text capability](../../speech/speech-to-text/README.md)
- [Hosted bundle](../../bundle/hosted-app/README.md)

## Model Experience

Indirectly, through the consumer that puts a transcript in its own message or prompt; this package adds no prompt section or tool of its own, so a consumer pays for dictated text as ordinary input.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Cloud only** — without a reachable Aeven API the provider fails; there is no offline path and no bundled model.
- **One recording per request** — no streaming partials, no diarization, and no speaker labels.
- **Billing follows the caller's session** — a Host that cannot resolve a signed-in session cannot transcribe, by design.


### Dev Note

No invariant companion is published: the provider's contract is the capability's, and its own behavior is covered by its specs rather than by an invariant.
