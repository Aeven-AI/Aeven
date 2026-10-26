# Agent Note: Prompt-cache warming while a tool call keeps the loop waiting

Status: implemented

English | [中文](2026-10-26-prompt-cache-warming.zh.md)

## Problem

A provider bills a cached prompt prefix only while its cache entry lives. A long tool call — a build, a test suite, a browser session, a subagent — leaves the loop waiting for minutes with the conversation unchanged, and the request that follows pays a full-price prefix read if the entry expired in between. DeepSeek publishes no cache lifetime ("cleared within hours to days"), and `@earendil-works/pi-ai` 0.84.2 carries no prompt-cache metadata at all, so no adapter in this repository can decide when a warm is worth sending.

The measurement that justifies the feature exists outside this repository: `dsh-warm` 0.2.0, a DeepSeek-harness host plugin published for exactly this problem, reports an idle-warming saving of $6.91 over 50 days against a $7.15 cost in the configuration where a tool result blocks the warm. That is the pilot this plugin follows, reshaped to Aeven's seams.

## Decision

### Warm only inside a tool block, never while a session waits for a human

`llm/stream` records the request a warm would replay. `tools/execute` opens the warming window for the duration of one tool call and closes it when that call settles; nested sub-calls increment a depth counter, so a `run_code` program keeps one window instead of restarting it per binding call, and `ask_user_question` is excluded by default because its block is a person deciding rather than work in progress.

The plugin does not warm an idle session, even though idling is often the longest wait. dsh-warm's own numbers show idle warming can cost more than it saves when nothing follows, so this ships the half the pilot measured as a win and leaves the other half to a deployment that measures it.

### The replayed request is the captured one, minus the output cap

A warm sends the captured `GenerateOptions` unchanged except `maxTokens: 1` and its own cancellation signal, so the provider sees a byte-identical prefix — the whole point of the exercise. Two fields are deliberately dropped: `sessionId`, because naming a session on a hand-built call triggers a durable flush that a warm has no reason to cause, and no attachments are ever replayed, because a captured request carrying a `file` or `image` block could re-upload a file on every ping.

`purpose` stays unset. A new purpose value would have to be honoured or ignored by every adapter and extension, and any extension that turns a purpose into a wire field would change the prefix a warm exists to preserve.

### The spend is logged, and the meter counts it

Each warm appends `cache-warm/start` before dispatch and `cache-warm/result` after, carrying the usage the provider reported or the failure that stopped it. `@aeven/token-meter` folds `cache-warm/result` usage into the session's `tokenUsage` totals, so warm spend appears beside turn spend rather than beside nothing; that is the gap auxiliary calls have today, where a review or a title call bills without being counted.

Three bounds keep the spend bounded in advance: `maxPings` per tool block, `maxConcurrentPings` across sessions, and `dailyPingBudget` per UTC day. `dryRun` journals the start events and dispatches nothing, which is how a deployment prices the feature on its own traffic first.

### Cache lifetime is configuration

DeepSeek publishes no TTL and pi-ai exposes none, so `providers` names each warmed provider with its own `intervalMs` and optional `maxPings`. A provider absent from that table is never warmed. The plugin ships `disabled: true` in the `aeven` preset with a DeepSeek row at 240000 ms as an example, not as a recommendation: a deployment sets it from its provider's documented lifetime with room for one request's latency.

### It cannot disturb the general assistant

A warm dispatches through the same `llm/stream` waterfall, so routing, retries, and provider auth apply unchanged, but its response is drained inside the plugin: no assistant message, no tool call, no prompt text, no steering. Nothing model-visible changes, so the conversation, the compaction path, and the turn review see exactly what they saw before. A tool's own signal cancels an in-flight warm, so a block that ends early stops paying immediately.

## Verification

`packages/llm/llm-cache-warm/tests/warmer.spec.ts` covers the window in both directions: no warm without a configured provider, an auxiliary purpose, an attachment, a small prefix, or outside a tool block; one logged warm per interval inside it; the ping, daily-budget, dry-run, and concurrency bounds; and the failure path. `packages/llm/token-meter` typechecks with the event folded into the usage projection, at `stateVersion: 3`.

Not covered: a recorded snapshot scenario. The plugin ships disabled, so no shipped profile produces `cache-warm/start` events, and warming is invisible on the model-visible surface by design.

## Alternatives considered

**Warm idle sessions too.** Idling is often the longest wait, but dsh-warm's own numbers show idle warming can cost more than it saves when nothing follows the idle period. This plugin ships the half the pilot measured as a win, and a deployment that measures the other half can extend the window without changing the request the warm replays.

**Bake a cache lifetime into the plugin.** DeepSeek publishes no lifetime and pi-ai 0.84.2 carries no cache metadata, so any constant here would be a guess presented as a default. `providers` makes the interval a deployment value, and a provider absent from that table is never warmed.

**A new `llm` purpose for warms.** Every adapter and extension would have to honour or ignore it, and any extension that turns a purpose into a wire field would change the prefix that the warm exists to preserve.

**Decide from the provider's cache-hit signal.** No adapter in this repository reports cache hits before a request, so nothing can tell the plugin whether the entry is still alive; the interval is the only lever available.

## Consequences

A tool block of several minutes no longer drops the cached prefix, and the spend it causes is visible: `cache-warm/result` carries the usage the provider reported and `@aeven/token-meter` folds it into the session's totals. The cost is an extra request per interval that bills even when the prefix was still warm, bounded by `maxPings`, `maxConcurrentPings`, and `dailyPingBudget`, and kept off entirely by `disabled: true` until a deployment opts in. A warm inside a tool block competes with the session's own requests for the provider's rate limits, which `maxConcurrentPings` bounds across sessions rather than eliminating.
