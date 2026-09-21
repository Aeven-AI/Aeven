# Agent Note: Recovering from a message-count rejection

Status: implemented

English | [中文](2026-09-21-message-count-rejection-recovery.zh.md)

## Problem

A conversation of more than 400 messages ended its turn permanently. The gateway answered `400`, the client classified the rejection as `INVALID_REQUEST`, and nothing downstream could act on it: `INVALID_REQUEST` is outside the default retryable set, so `llm-retry` never repeated it, and `compaction-basic` gates its overflow recovery on `CONTEXT_WINDOW_EXCEEDED_CODE`, so no reduction was attempted either. Every later message in that session hit the same wall, because the request that grew past the ceiling could not shrink itself.

The rejection arrived as `` `messages` may contain at most 400 entries `` and named the `messages` parameter. It matched none of the recognizers in `packages/llm/llm/src/error.ts`, which describe a token budget — context length, window, "too large for model context" — so a request that was admitted as shaped and then outgrew a count ceiling was reported as a request the model would never accept in any form. That is the misclassification the recovery path depended on and never got.

The ceiling itself was invented by this deployment. DeepSeek's chat-completions schema bounds `messages` from below (`>= 1`) and states no upper bound, and a conversation is bounded by the model's context window long before a count that matters, so a count ceiling refuses requests the provider would have answered. Only a session with a long tail of small entries — one tool result per row, which is how the harness serializes them — reaches it while still holding few tokens.

## Decision

The count ceiling is removed, and a count rejection is made recoverable for the deployments that keep one.

`INFERENCE_MAX_MESSAGES` no longer has a default. `services/inference/config.js` resolves it to `null` unless a deployment sets it, and `RequestNormalizer` skips the check entirely for a null bound. The bound that already protects the endpoint is `maxBodyBytes`, which is applied before the body is parsed; an entry count was a ceiling the provider never asked for. A deployment that wants one sets `INFERENCE_MAX_MESSAGES` to a positive integer, and an unusable value resolves to no ceiling rather than to a bound of zero, which would refuse every request.

A rejection that does name a message-count ceiling is now its own failure class rather than an invalid request. `MESSAGE_COUNT_EXCEEDED_CODE` is a canonical code in `packages/llm/llm/src/error.ts`, and `isMessageCountExceededError` recognizes the wording a gateway uses to state one. The recognizer requires the `messages` parameter name beside the entry count, because a number and the word "entries" appear in rejections about other arrays, and a match without that anchor would turn an unrelated refusal into an endless compact-and-retry loop. Both delivery paths run it: `httpErrorCode` on a non-2xx response, and `mapStreamError` on an in-band error frame after the response has begun.

`compaction-basic` treats the new code the way it treats context overflow. Its `agent/request-error` listener accepts either code from one set, shares the `maxOverflowRetries` budget between them, and labels its logs with the bound it recovered from, so an operator can tell a token ceiling from a count ceiling. A reduction replaces a range of surface nodes with one checkpoint, so it lowers both the entry count and the token count, and the retry is authorized only when that reduction actually advanced the surface — an endpoint that keeps refusing and a surface that cannot shrink further end the turn as before rather than spinning.

## Alternatives considered

**Raise the gateway ceiling instead of removing it.** A larger number is still a number this deployment chose, still refuses conversations the provider would serve, and moves the wall rather than deleting it.

**Declare a per-route row limit and have the client shrink before sending.** The harness counts tokens, not wire rows; the row count exists only after the adapter serializes the request, and the entry ceiling is a property of the endpoint behind the adapter rather than of the model. Making the client carry it would add a configuration value that has to agree with the gateway's, and a disagreement still ends the turn — now before the user has been told anything.

**Rely on `maxBodyBytes` and skip the recovery path.** Correct for the default configuration and wrong for every other one: a deployment that sets `INFERENCE_MAX_MESSAGES`, and any gateway in front of this client that enforces its own count, produces exactly the rejection that could not be recovered from.

**Add the new code to the default retryable set.** A repeat sends the same oversized request; only reducing the conversation changes the answer, which is what compaction owns.

## Consequences

A session that outgrows an entry ceiling now continues: the client reduces the replaced region, writes the summary checkpoint, and retries the request once. The default deployment has no such ceiling, so it does not compact for this reason at all.

The failure code is new to the session log, so a client built before this change reads `MESSAGE_COUNT_EXCEEDED` as an unrecognized code rather than as `INVALID_REQUEST`. Recovery is bounded by `maxOverflowRetries`, shared with context overflow, so a rejection that survives reduction still fails the turn instead of looping.

A count ceiling is not a token ceiling, and the two are now reported apart; an operator reading the logs of a recovered turn can tell which bound the conversation reached. The recognizer also matches wording that versions of DeepSeek's own API do not use, which is deliberate — the count ceiling is a gateway's rule, so the client recognizes the rule rather than the vendor.
