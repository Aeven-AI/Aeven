# Agent Note: A route may refresh its model list from the provider, additively

Status: implemented

English | [中文](2026-08-28-live-provider-model-catalog-refresh.zh.md)

## Problem

A pi-ai catalog route serves `getBuiltinModels`, a static snapshot inside `@earendil-works/pi-ai` regenerated on its maintainers' cadence. It therefore lags whatever the provider currently lists, and nothing in the harness could close that gap.

Measured against OpenRouter's live `GET /api/v1/models` on 2026-08-28: 387 models published, 346 in the installed snapshot, **81 missing** once `:batch` variants are set aside, and 46 snapshot entries no longer listed upstream. The absences were not obscure — `deepseek/deepseek-v4-flash-vision-exp`, `z-ai/glm-5.3`, `qwen/qwen3.8-flash`, `x-ai/grok-4.20-multi-agent`, the whole `perplexity/sonar*` family. A session told to switch to an image-capable model could not select one, because the only such DeepSeek route on OpenRouter was missing from the snapshot.

Upgrading the dependency is not the fix. pi-ai 0.84.3, the current latest, ships 351 models and still misses 78.

## Decision

**A route may name a model document to refresh from.** `catalogRefresh: { url, format?, requireTags?, timeoutMs? }` on a provider profile fetches the provider's OpenRouter-style `GET /models` once at mount, materializes the published entries the snapshot does not describe, and re-resolves so the additions reach every selector. The models join the installed defaults before anything reads them, so `models`, `modelOverrides`, and their diagnostics treat a refreshed model exactly as they treat a shipped one.

**The refresh is additive by contract; a published entry never replaces an installed one.** The snapshot carries hand-tuned `compat` and `thinkingLevelMap` values the document does not express — reasoning dialects, developer-role support, per-level wire spellings. Deriving those from `supported_parameters` would silently downgrade models that work today, trading a listing gap for a correctness regression. Correcting an installed entry stays `modelOverrides`, whose diagnostics already name a miss. An added model declares only what the document implies: capacities, accepted modalities, and — when it advertises a reasoning parameter — the OpenRouter dialect with low/medium/high. Everything else is left absent rather than guessed.

**A failed refresh is not a failed route.** An unreachable, slow, or malformed document logs a warning and leaves the route serving the snapshot: a provider's list being briefly unavailable must not take the route down with it. Misconfiguration is the opposite case and fails loud at resolution — a `catalogRefresh` block naming no `url` is refused, because nothing else in the profile can supply the document's location.

**A provider pi-ai does not ship can still be first-party.** `KNOWN_ROUTES` is a table of providers this package knows how to configure — currently DeepInfra — carrying the protocol, endpoint, credential reference, and refresh a profile would otherwise state. Entries join the configurable-provider directory beside pi-ai's own and are marked `declared: false`, because a stored profile there is a credential rather than a route someone had to describe. Nothing in the table registers a route: which adapters exist stays composition, and which providers run stays the user's settings document, exactly as the shipped `llm-pi-ai` row says.

A route earns a place only when its models can be maintained without anyone editing configuration — that is, when the provider publishes a document this package can read. A provider whose models would be hand-listed belongs in a deployment's own settings, where the list is visibly owned, rather than in a shipped table that would rot exactly as the pi-ai snapshot does.

**Documents come in layouts, not one shape.** `format` selects between `openrouter` (capacities, modalities, and accepted parameters at the top of each entry) and `openai-models` (the plain OpenAI listing, extended under `metadata`, which is what DeepInfra publishes). `requireTags` admits only entries carrying every named tag, because DeepInfra lists image, video, speech, and embedding models in the same document a chat route reads — 190 entries of which 106 are chat.

**A known route resolves empty once rather than being refused.** Resolution is synchronous at mount and the first fetch answers after it, so a route whose models come only from the document would otherwise be rejected before the refresh could fill it, and would then never register. An empty route serves no request and stays out of the browser catalog until its models arrive. A route that is neither a catalog route nor a known one, and lists no models, is still refused — nothing would ever fill it.

**Refresh is opt-in for every other route.** No shipped composition enables it. A deployment that wants it names the endpoint, which is also the only way to state one: no URL is a safe guess, and a default would make every route reach the network at mount.

## Verification

`live-catalog.spec.ts` covers the mapping (protocol, endpoint, capacities, per-million cost from per-token decimal strings, modality filtering to pi-ai's vocabulary, reasoning levels only for an entry that advertises them, and nothing guessed for one that does not), the additive merge (installed ids skipped, duplicate published ids keeping the first, unusable entries skipped without failing the document), the fetch's failure modes (non-OK, timeout, caller cancellation), and configuration resolution (timeout defaulting, absent block, and the url-less block that is refused).

Route materialization is asserted end to end: a refreshed model reaches `piProvider.getModels()` beside the whole installed catalog, a route with no refresh serves the snapshot unchanged, and a published entry colliding with a tuned installed id leaves that entry's name and capacities untouched.

Against the real endpoint the OpenRouter route goes from 346 to 433 models, and `deepseek/deepseek-v4-flash-vision-exp` materializes with `["text", "image"]`, a 1,048,576 context window, and a 384,000 output cap.

DeepInfra is verified the same way, from a profile carrying nothing but `apiKeyEnv`: 106 chat models materialize out of 190 published entries, the route resolves to `openai-completions` against `https://api.deepinfra.com/v1/openai`, `Qwen/Qwen3.5-27B` reads its real 262,144 context window from `metadata` rather than the route fallback, its vision tag becomes `["text", "image"]`, and no image, embedding, or speech model reaches the route.

## Consequences

A route that enables refresh performs one outbound request at mount. It is unauthenticated and cancelled on fiber disposal, but it is network at startup, which is why it is opt-in.

Added models carry no tuned compatibility. A refreshed model that needs a reasoning dialect the document does not express will need a `models` entry stating it — the same edit its shipped siblings never require. This is the deliberate cost of refusing to guess.

The published document is an external input, so the refresh reads it defensively: entries are structurally typed as `unknown` and validated field by field, and one unusable entry never fails the document.

`ResolvedPiAiProviderProfile` now overrides `catalogRefresh` with a resolved shape whose `url`, `format`, `requireTags`, and `timeoutMs` are all present, so the runtime never re-checks what resolution already settled.

DeepInfra now appears in the configurable-provider directory for every deployment. It runs nothing until someone stores a credential, but it is one more provider in that list, and its entry asserts a protocol and endpoint this repository now owns: if DeepInfra moves either, the table is what needs updating.

Adding a second document layout makes `format` a compatibility surface. A third provider whose listing differs again is a third branch in the same readers, not a new module; if that table grows past a handful, the readers should become per-format modules rather than widening conditionals.

## Alternatives considered

**Bump pi-ai and move on.** Rejected on measurement: the current latest closes 5 of 87 gaps. The lag is structural, not a stale pin.

**Replace the snapshot with the live document wholesale.** Rejected: it discards exactly the hand-tuning that makes reasoning models work, and the regression would appear as subtly wrong requests rather than a missing model.

**Fetch the document per request, or on a TTL.** Rejected for now: one fetch at mount answers the stated problem, and a cache with an expiry policy is state to own — invalidation, concurrent refreshes, backoff — with no current consumer asking for mid-session freshness.

**Ship a DeepInfra provider profile in the base composition.** Rejected: the shipped `llm-pi-ai` row states that which providers run is the user's settings document, and a profile in the composition would start a route — and its outbound refresh — for every deployment whether or not anyone wants that provider. The directory entry gives the same discoverability without running anything.

**Reuse the OpenRouter reader for DeepInfra.** Rejected on measurement: the fields do not overlap. Every model would take the route's default context window instead of its real one, labels would be raw ids, prices would read as zero (one layout publishes decimal strings, the other numbers), and the 84 non-chat entries would fill the selector with models the route cannot call.

**Derive `compat` from `supported_parameters`.** Rejected: the field names which parameters an endpoint accepts, not which dialect it speaks. `reasoning_effort` being accepted says nothing about whether reasoning arrives as `reasoning_content` on assistant messages, and guessing wrong is a broken request rather than an absent feature.
