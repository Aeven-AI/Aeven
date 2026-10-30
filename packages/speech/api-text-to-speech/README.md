---
description: "Authenticated speech synthesis Remote for browser clients."
kind: "package-reference"
---

# @aeven/api-text-to-speech

## Summary

This Remote exposes the `tts` namespace to Clients: the voice catalogue and per-sentence synthesis, with caller cancellation carried through to the provider.

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

Load beside the service it fronts and a Typert gateway. `catalog()` lists voices and the language mapping; `synthesize({ text, language })` returns base64-encoded audio and the voice that produced it. `maxTextChars` bounds one utterance, and a longer text is refused before any provider is called.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

Synthesis never creates a Session event: a reply is read from text the Session already logged. The Client's abort signal reaches the provider, so a stopped reader stops paying for audio it will not play.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Speech synthesis subsystem](../../../docs/subsystems/speech.md)

-----

<a id="model-experience"></a>
## Model Experience

None. The Remote carries no model-visible input or output.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

One request renders one sentence's worth of text; longer passages are the caller's segmentation decision.

-----

<a id="dev-note"></a>
## Dev Note

The controller exposes the seam over the `tts` Remote namespace and holds no state of its own: nothing it carries is model-visible, so it logs no session event and replay cannot diverge from a live run. `maxTextChars` bounds one request because the Surface segments a reply before asking; a longer body is rejected before the provider is touched.

Cancellation is the caller's signal, passed straight through to synthesis, so a stop mid-clause aborts the provider request rather than buffering audio nobody will hear.
