---
description: "Composer read-aloud toggle over the Host speech synthesis Remote."
kind: "package-reference"
---

# @aeven/client-ui-tts

## Summary

This browser plugin adds a speaker toggle to the composer's leading control row. While it is on, each assistant reply is read aloud fragment by fragment, from audio the Host synthesizes and this browser plays.

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

Load beside the Host's [`text-to-speech`](../../speech/text-to-speech/README.md) rows. Reading is per Session and starts off: the toggle switches it on for the open Session only, and a reload returns to off. Turning it on mid-reply reads from that point on, not the text already on screen.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The toggle reads the live step through the standard `useChat` seat, flattens its text blocks (code and tables are dropped), and hands the growing text to one engine per Session. The engine cuts fragments at a finished sentence, or at a clause once that clause carries enough text to speak on its own (12 characters, 4 for Chinese), and never hands the Host more than 120 characters, because Edge spends roughly 50ms per character before it returns audio. Four fragments synthesize in parallel ahead of playback, and decoded buffers are scheduled on a single `AudioContext` with a gapless start time per fragment; the click that switches reading on also resumes that context, so the first fragment does not wait for an unsuspend. A fragment the Host cannot synthesize is retried once and then skipped, so one failure does not silence the rest of the reply. A new step or a disabled toggle stops every scheduled source and aborts the syntheses in flight.

The spoken language is chosen per fragment: the script decides Japanese, Korean, Chinese, Arabic, Hebrew, Russian, Greek, Hindi, and Thai outright; otherwise a language's own letters and stopword scores separate the Latin languages, and the language already being read breaks ties. Every other language reaches the Host's full Edge catalogue, where the language's home region speaks it, so a reply in a language this plugin does not score still gets its own voice.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Speech synthesis subsystem](../../../docs/subsystems/speech.md)

-----

<a id="model-experience"></a>
## Model Experience

None. The plugin reads text the model already produced and sends nothing to it.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

The toggle is Session-scoped: a reload restores the flag, but two Sessions read at once and the composer row has no global stop. The voice picker writes a per-language preference in this browser only.

-----

<a id="dev-note"></a>
## Dev Note

Three decisions hold the reader together. The engine schedules decoded buffers back to back through `AudioBufferSourceNode`s, so the queue rather than the player decides what is missing: `pump()` keeps four fragments prefetched and twelve seconds scheduled ahead, and `drain()` re-pumps in its `finally`. A stop interrupts the drain while its clause is still in flight; without that re-pump the next request would find the channel pumping and play nothing.

The per-message action runs on its own channel, `message:<id>`, so reading one message cannot disturb a running reply and a reply cannot cut a message off. The session toggle keeps the plain session channel.

`toSpeechText()` strips Markdown emphasis and then any residual emphasis or table marker, because a reader that receives one announces it — "asterisk" for bold text, for example.
