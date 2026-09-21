# Agent Note: In-band stream error frames

Status: implemented

English | [中文](2026-09-21-in-band-stream-error-frames.zh.md)

## Problem

`translate()` in `@aeven/llm-deepseek` reads one SSE payload at a time and looks only at `choices`, `usage`, and `system_fingerprint`. An OpenAI-compatible gateway that fails *after* the response has begun cannot restate the 200 it already sent as a 4xx or 5xx, so it reports the failure in-band — `{"error":{"message":…,"type":…,"param":null,"code":…}}` in place of the next chunk — and then closes the stream with no `[DONE]` sentinel. That body matched none of the fields being read, so it passed through unremarked and the missing sentinel raised the reader's own fallback instead: `SSE stream ended without [DONE]`, code `STREAM_CLOSED`.

Those are not the same failure. `STREAM_CLOSED` says a connection broke; the frame said the provider had answered, failed, and named the failure with the gateway's own code. A caller could not tell them apart, so a turn whose provider went away read as a transport accident with nothing to act on and nothing to report.

The shape was observed end to end on 2026-09-21: turn 3 of session `1c671b68` in the Web GUI failed its ninth step at 18:06:34Z with exactly that `STREAM_CLOSED` wording, after deltas had already reached the page. The local gateway's usage ledger records the same request at 18:06:31.989Z as `provider_unavailable` — the frame that reached the client was serialized from that same failure object, so its code was `provider_unavailable` and the ledger is the only place it survived. The client had it in hand and discarded it.

## Decision

A frame is now decoded as a union of the two things a frame can be. `WireFrame` extends `WireChunk` and `WireError`, so `error` is read beside `choices`, and the reader throws an `LlmError` built by a new `mapStreamError` before it looks at anything else the frame might carry.

`mapStreamError` classifies in one order, from the most specific fact to the least. An exhausted account quota and a request that outgrew the model window — neither of which arrives here with a status code to say so — run through the same `isQuotaExceededError` and `isContextWindowExceededError` recognizers the non-2xx path uses, so one failure classifies identically however it was delivered. Otherwise the gateway's own `code` is passed through upper-cased rather than flattened into `SERVER`, because that vocabulary is what a caller routes on. A frame with no code at all is `SERVER`, and a body that states neither a message nor a code says so instead of leaving a message dangling after a colon.

The message names the delivery rather than the request — "the provider failed after the response began" — because that is what a reader is looking at: an answer that stopped, not a request that never started.

Every member of `WireError['error']` is declared nullable, matching the convention `content` and `finish_reason` already follow. The type is a claim about a remote encoder, and a gateway that spells "nothing here" as an explicit `null` must not turn a classification into a `TypeError` on the way to a diagnostic.

## Alternatives considered

**Leave the truncation as the answer.** Skipping the frame and letting the missing sentinel raise `STREAM_CLOSED` is what the code did, and it is defensible as a transport-level fact. Rejected: it is the only fact the caller was left with, and it is false about the provider. The gateway had already decided the request failed and said why; discarding that decided to know less.

**Fold every in-band code into `SERVER`.** The harness's own generic bucket would have been one line and no new vocabulary. Rejected: `SERVER` is what a caller gets when nothing else is known, and here something is known. A route's retry policy is configuration over these codes, and a code that identifies the gateway's own outage is exactly the one worth being able to name.

**Also refuse to retry a stream that already emitted deltas.** The retry policy decides purely on the failure code, so a `PROVIDER_UNAVAILABLE` frame on a route that retries it would replay a turn whose first half the reader has already seen. Not done here: the harness default route does not retry that code, and a partial-output guard is a change to `@aeven/llm-retry`'s contract that belongs with the retry policy rather than with the reader. It is left visible rather than silently decided.

**Surface the failure through `finish` instead of throwing.** A `{kind: 'error'}` finish reason already exists in the stream protocol, so the frame could have been translated into one. Rejected: the frame arrives before the end of the stream, and a generator that yields a finish and then continues reading would have to decide what to do with the rest of the payloads — the gateway closes without a sentinel, so the sentinel's own contract would be the next thing broken.

## Consequences

The failure that reached the app now names the gateway's own code. [translate.spec.ts](../../../../packages/llm/llm-deepseek/tests/translate.spec.ts) pins it: the deltas that arrived before the frame stay delivered, the named error follows them, and quota, context, bare upstream, and unnamed bodies each classify through the case they belong to. A stream with no error frame is still `STREAM_CLOSED`, because that is still exactly what it is.

The same defect existed one layer up, in the gateway that emits these frames: `servers/node`'s `DeepSeekProvider` read only `choices` as well, so an in-band frame from DeepSeek was replaced by its own generic "the response stream ended before it completed". That adapter now classifies the frame through the recognizers its non-2xx path already uses, and the gateway logs the code, the message, and the count of characters already forwarded, so the server's own account of a truncated turn no longer needs the client to reconstruct it.
