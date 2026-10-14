---
description: "Composer dictation: a microphone control that records speech into the draft, with a live waveform, and the Settings voice section that prepares the recognizer."
kind: "package-reference"
---

# @aeven/client-ui-voice-input

English | [中文](README.zh.md)

## Summary

Dictation turns the composer's microphone into a recorder: the control row becomes a timer and waveform, the microphone is filtered and cut into frames by an AudioWorklet voice detector that keeps only speech, and the transcript is appended to the draft. Silence never leaves the browser, and what is sent is one canonical PCM16 WAV. Settings → Voice prepares and reports the recognizer's model, and the application menu's dictation command starts a recording through the same composer control. Recording needs a prepared recognizer: the control sends the reader to that section rather than starting a download in place.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose it in a web client whose composer should accept dictation. It needs `remote`, `remote.speech`, `slots`, and `locale`. `apply` registers the composer control, the Settings voice section, and the dictionaries inside effects on the plugin fiber, and one reconnecting readiness mirror follows `speech.follow` for every occurrence of the UI, so the mic and the settings section agree about the recognizer. The control calls `speech.transcribe` with the recorded audio and the selected provider; the settings section calls `speech.prepare` and shows the preparation phase it reports.

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when dictation's own contract is not enough: the composer it extends and the settings surface it adds to.

- [ui-conversation](../ui-conversation/README.md) — the composer whose control row dictation occupies.
- [ui-settings](../ui-settings/README.md) — the settings domain the voice section joins.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the conversation composer's draft: a transcript this plugin appends becomes the user message the model reads, so dictated words reach a request only once the user submits them.

#### KV Cache effect

None; this package neither assembles nor sends a provider request, and the words it inserts are ordinary user-message text.

## Known Limitations and Deferred Work

These limits define what dictation keeps and what it leaves to the Host.

- **No invariant companion** — No invariant companion is published because the plugin owns one capture per recording, one readiness mirror fed by the Host speech stream, and effect-owned registrations; each is released when its recording ends or the plugin fiber goes, and no second authority observes the same capture.
- **Only speech is kept** — frames under the detector's thresholds are dropped, so a passage quieter than the thresholds can be lost and a recording with no speech produces nothing.
- **The transcript is ordinary draft text** — it can be edited or deleted like typed words, and nothing about the message records which words were dictated.
- **A failed transcription is reported, not retried** — the mic shows the Host's message and the recording is dropped.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
