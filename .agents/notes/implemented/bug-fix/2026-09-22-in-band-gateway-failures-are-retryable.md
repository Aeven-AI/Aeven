# Agent Note: In-band gateway failures are retryable on the Aeven route

Status: implemented

English | [中文](2026-09-22-in-band-gateway-failures-are-retryable.zh.md)

## Problem

The `aeven-cloud` route (`@aeven/llm-aeven`) fronts the Aeven gateway, which is a second boundary in front of the model provider. Once the gateway has begun a stream its status is fixed at 200, so an upstream failure it can no longer report as a status arrives *inside* the stream as an error frame, carrying the gateway's own contract code (`provider_unavailable`, `provider_timeout`, …) and the upstream transport detail.

`DeepSeekAdapter`'s `mapStreamError` passes that vocabulary through upper-cased rather than flattening it into a canonical harness code, which is the adapter's recorded decision: the gateway's code is the specific fact a caller routes on. What no one owned was retryability. The shared normal retry default knows only the canonical codes (`EMPTY_RESPONSE`, `RATE_LIMIT`, `SERVER`, `TIMEOUT`, `TRANSPORT`), so not one of the gateway's codes matched it, and `@aeven/llm-retry` delegates instead of retrying: the turn ends on its first attempt.

The observed failure is exactly that shape — `the provider failed after the response began: deepseek is unavailable: fetch failed: other side closed` — where `other side closed` is the gateway's upstream socket dropping mid-response. Reported as a status the identical failure classifies as 503 → `SERVER` and is retried; delivered in-band it was not, so the delivery path decided whether the user's turn survived. The gateway marks `provider_unavailable` retryable in its own contract, so the route was disagreeing with the boundary it fronts.

## Decision

The `aeven-cloud` route resolves its own retry policy when the composition configures none: the canonical five plus the six codes the gateway's contract marks worth resending — `PROVIDER_UNAVAILABLE`, `PROVIDER_TIMEOUT`, `PROVIDER_ERROR`, `RATE_LIMITED`, `CONCURRENCY_LIMITED`, `INTERNAL`. `maxRetries` and `backoff` are deliberately left unstated in that value so `resolveRetryPolicy` fills them from the shared budget, which stays the one place that budget is decided for every route.

The route owns this because the vocabulary is a fact about its upstream, not about the transport: the same `DeepSeekAdapter` serves `deepseek-official`, whose failures never carry Aeven's contract codes. Route-owned policy stays authoritative — a `retryPolicy` in the plugin row or a user-settings section replaces the whole value, and the resolved per-provider policy continues to be captured at registration as [per-provider request retry policies](../feature/2026-07-24-provider-retry-policies.md) requires.

## Alternatives considered

**Canonicalize the gateway's codes inside `mapStreamError`.** This completes the file's stated invariant in the place failures already become harness failures, and it would fix the same gap for any future route in front of the gateway. It loses because it defeats a tested decision: the adapter deliberately preserves the gateway's vocabulary (`PROVIDER_UNAVAILABLE`, `PROVIDER_ERROR`, `PROVIDER_TIMEOUT` are pinned as pass-through), and collapsing `provider_unavailable` into `SERVER` would erase the specific fact a caller routes on in order to correct a policy any route can state directly.

**Add the six codes to the shared default set.** One edit, every composition. It loses because the shared set is provider-neutral: `deepseek-official` and every future route would inherit retry decisions for vocabulary only this gateway sends, and the codes would stop meaning anything about the upstream that produced them.

**Resolve `mode: 'always'` on this route.** Unbounded recovery needs no code list and cannot miss a code the gateway adds later. It loses because it spends requests and backoff time on failures that cannot succeed on a resend — a rejected session, an exhausted balance, a context overflow — and because the gateway's own contract already separates those from the transient ones this fix adopts.

**Report the mid-stream failure as a status.** The cleanest client story, and impossible: headers are long sent when the upstream dies, which is why the gateway closes the stream without `[DONE]` so a client reads it as a failed response rather than a short valid one. The gateway's in-band delivery is correct; the client is the side that must classify what it received.

## Consequences

- A transient upstream outage on this route consumes a bounded retry — five attempts on the shared backoff — instead of ending the turn. Partial output from the discarded attempt still does not enter the next request; that guarantee is the retry machinery's, unchanged here.
- Retryability on this route is no longer identical to the shared default, so the two DeepSeek-transport routes differ by code set. The route states why: it is the only one of the two that has a gateway in front of it.
- The six codes track another repository's contract. A code the gateway renames would silently stop matching, and a new transient code it starts sending would need adding here; the gateway's own `RETRYABLE_CODES` is the source of truth for the list, not this file.
- `packages/llm/llm-aeven/tests/connection.spec.ts` pins the omitted resolution: the shared budget (`maxRetries: 5`, 500 ms → 10 s, 0.1 jitter) and the exact eleven-code set, so a narrowed or reordered list fails a test rather than a user's turn.
