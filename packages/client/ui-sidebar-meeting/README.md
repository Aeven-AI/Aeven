---
description: "The right sidebar's Recorder: transcribes a meeting from the microphone and the computer's audio, labels the speakers, and saves the recording."
kind: "package-reference"
---

# @aeven/client-ui-sidebar-meeting

English | [中文](README.zh.md)

## Summary

The Recorder pill records a meeting on the reader's own computer: the microphone as "You", with Chromium's system-wide echo cancellation, and the computer's audio as the others — the desktop shell answers an audio-only `getDisplayMedia` with system loopback on macOS, Windows, and Linux. Each source becomes utterances of several sentences, transcribed whole through the speech Remote as dictation transcribes one recording. While the Host's speaker diarizer is ready, each of Whisper's timed sentences takes the voice that spoke most of it, and the voices of one meeting are numbered Speaker 1, Speaker 2, and so on. A recording that ends with transcribed speech is saved, with its audio, through the speech Remote; the pane lists, plays, copies, adds to the chat, and deletes saved recordings in a modal.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose it in a desktop web client. It needs `sidebarContent`, `remote`, and `remote.speech`, and registers the `meeting` pane, its dictionaries, and a close handler that stops the recording inside effects on the plugin fiber. One recorder serves every pane, so a recording continues across sessions. Opening a pane calls `speech.prepareDiarization` while the diarizer is unprepared, and a progress bar follows `speech.followDiarization`. The recorder transcribes with the reader's selected voice provider; under automatic language detection it settles on the language most of the meeting's speech was detected in and decodes the rest, including earlier phrases detected otherwise, in that language. "Add to chat" appends the transcript to the pane's session composer.

-----

<a id="further-exploration"></a>
## Further Exploration

- [api-speech-to-text](../../speech/api-speech-to-text/README.md) — the Remote the Recorder transcribes, diarizes, and saves through.
- [speaker-diarization](../../speech/speaker-diarization/README.md) and [recordings](../../speech/recordings/README.md) — the Host services behind those calls.
- [ui-sidebar-select](../ui-sidebar-select/README.md) — the content registry this pane registers into.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the conversation composer's draft: a transcript the Recorder adds to the chat becomes the user message the model reads, so a meeting reaches a request only once the user submits it.

#### KV Cache effect

None; this package neither assembles nor sends a provider request, and the transcript it inserts is ordinary user-message text.

## Known Limitations and Deferred Work

- **No invariant companion** — No invariant companion is published because the recorder is the only owner of the recording it shows: every pane renders that one recorder's snapshot, so the client keeps no second copy of the state an observer could compare against it.
- **Desktop only** — the hosted bundle disables the pane, and its sidebar entry opens the desktop hand-off dialog instead; recording audio travels between the account's desktops through file sync, which the hosted Host does not run.
- **System audio is the whole computer** — the loopback captures everything the computer plays except Aeven itself, not only the meeting app.
- **Short interjections can take the wrong speaker** — a stretch under four seconds joins the closest known voice instead of founding a new one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The capture worklet low-passes each source at 7.2 kHz before resampling to 16 kHz: without it, aliasing made different speakers' voice embeddings look alike and the meeting collapsed into one speaker.

</details>
