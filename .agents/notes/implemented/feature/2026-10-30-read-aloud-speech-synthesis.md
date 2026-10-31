# Agent Note: Read aloud as a speech synthesis seam

Status: implemented

English | [中文](2026-10-30-read-aloud-speech-synthesis.zh.md)

## Problem

Aeven could speak no reply, and no seam existed to add it: the model had no way to ask for reading, the Host had no synthesis provider, and the Web client had nowhere to put a reader's choice of voice. Speech recognition already had a definition/provider/Remote/tool stack, so synthesis needed the same shape rather than a bespoke path. Building it surfaced three product problems that a naive implementation would have shipped: a language with no configured voice fell through to whichever voice the provider listed first, which for Japanese was a male voice; the toggle forgot itself the moment the reader opened another Session; and Markdown left in the spoken text made a reader announce "asterisk" between words.

## Decision

**Synthesis is a capability seam with all three roles shipped.** `@aeven/text-to-speech` owns the definition: named provider registration with disposable admission, a reserved voice-id space so one id names one voice across providers, and an explicit `resolve(request): TtsSpec` step that turns a language or an exact voice id into the voice actually used. `@aeven/text-to-speech-edge` provides it through Aeven's own Edge client, `src/edge-tts.ts`: it speaks the read-aloud WebSocket protocol against `api.msedgeservices.com`, lists the roster on the legacy host that still answers one, and falls back to configured voices. `@aeven/api-text-to-speech` is the Client consumer: a Remote controller under the `tts` namespace with a character ceiling, cancellation through the request signal, and no Session event, because audio is presentation rather than model-visible context. `@aeven/tool-read-aloud` is the model consumer, an `enabled` switch the agent calls during language practice.

**A language's default voice is female, decided at the rung the fallback already took.** The provider listing carries the timbre each voice reports, the catalogue keeps it, and `resolve` prefers a female voice at every rung: the language's dominant locale first (`zh-CN` over `zh-HK`, `ja-JP` over `ja-JP` variants), then any voice of the exact language, then the language family, then a multilingual voice. A configured `voiceByLanguage` entry still wins outright, and a configured row keeps the timbre the provider reported when the row omits it, so mapping a language never re-introduces a male default. The picker reads the same rule to name the voice a language falls back to.

**The reader is a streaming engine, not a request per reply.** `@aeven/client-ui-tts` cuts speakable clauses out of the growing reply text as it arrives, prefetches four fragments, keeps twelve seconds of audio scheduled ahead, and plays decoded buffers back to back so concatenated fragments do not gap. Text that arrives later continues the queue instead of cutting the sentence already speaking, and a step change flushes only the unterminated tail. Markdown is flattened before synthesis: fenced code, tables, link targets, and every residual `*`, `_`, `~`, backtick, or pipe is removed, so no reader says a marker's name.

**Reading is a standing preference, and one message can be read on its own.** Switching the toggle on stores the choice in the browser, and a Session opened later restores it once, without reopening one the reader already switched off; an agent's `read_aloud` call persists the same flag, because it moves the same toggle. The per-message action beside `Branch into a new session` reads one settled assistant message on its own channel, so it neither disturbs nor depends on the Session channel: it shows a spinner until the first fragment is audible, shows the stop glyph while it plays, and starts again from the top on a second request. A drain interrupted by a stop hands any still-queued work to a fresh drain, which is what makes that second request audible at all.

## Verification

The service, the Edge provider, and the Remote controller are exercised through their own suites, and the client engine, sentence splitter, and picker through the GUI tier. The voice rule was measured against the live Edge roster: all 75 languages resolve to a female voice, `ja` to `ja-JP-NanamiNeural` where the earlier fallback produced a male voice, `zh` to a Mandarin voice rather than a Cantonese one, and the configured `en`/`nl`/`es` entries still win. In the browser, the read-aloud toggle survives a reload with its stored flag, the per-message action reports preparing and then speaking, a stop followed by a fresh request reaches audio again in about a second, and a reply containing bold text, bullets, inline code, and a table is spoken without any marker names.

## Alternatives considered

**Speak each reply through one synthesis request.** Rejected because the wait for the first words equals the length of the reply, and because a stopped read cannot resume without re-synthesizing everything.

**Let the provider decide the default voice.** Rejected because provider listing order is not a product decision: it produced a male Japanese voice and a Cantonese default for `zh`.

**Keep the reader's choice per Session.** Rejected because reading is how the reader wants Aeven to behave, not a property of one conversation; language practice and hands-free use both continue across Sessions.

**Strip Markdown with a stricter parser before speaking.** Rejected for now: the splitter runs on a still-arriving string, where a real parser needs a complete document. Removing closed pairs and then residual markers covers the streaming case with one extra rule.

## Consequences

- Adding a provider means implementing the definition and passing the timbre it reports; a provider that reports none yields no female preference, and its languages fall back in listing order.
- Spoken text is derived in the Client, so a change to how replies render as Markdown must keep `toSpeechText` in step with it.
- The per-message action shares the engine's channel map with Session channels; a channel id that collides with a Session id would mix two readers' queues, so the message channels stay namespaced.
- Audio never enters the Session log, so a replay has no record of what was spoken.
