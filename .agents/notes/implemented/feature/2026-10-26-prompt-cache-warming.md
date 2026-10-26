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

## Alternatives considered

**Wait for the provider to refresh the entry.** DeepSeek bills a hit only while the entry lives and offers no keep-alive, so a session that stalls for a long tool call pays a full-price prefix read unless something replays the prefix itself.

**Warm on an idle timer as well as inside tool blocks.** The longest waits are usually a human reading a reply, which is the case with no measurement behind it here: `dsh-warm` justified its idle mode from a streaming run this repository has not recorded. The plugin stays inside tool blocks until a deployment reports that window.

**Warm synchronously before the tool returns.** The prefix is known at block start, but sending the warm then puts a provider round trip between the tool and its result and serializes parallel calls behind one ping. Appending after the tool result keeps the conversation order unchanged.

**Read a cache TTL from provider metadata.** No adapter here exposes one, and adding a per-adapter field would put a deployment decision inside a client that cannot observe it. `intervalMs` is configuration instead.

**Record the spend only in the plugin's own log.** Warm spend would appear beside nothing: a review or title call bills today without reaching `tokenUsage`, and repeating that gap for a higher-frequency call hides the cost the bounds exist to control.

## Consequences

- Two log-only events and a `stateVersion: 3` bump in the usage projection; nothing model-visible changes, so no snapshot scenario records the feature.
- The plugin ships `disabled: true`. A deployment opts in by naming a provider with an `intervalMs`, and the example row is not a recommendation.
- A byte-different prefix suppresses the warm rather than paying for a second cache entry, so a deployment that changes its system prompt or tool schemas mid-session warms only after the prefix settles.
- Spend is bounded per tool block, per day, and across sessions, and `dryRun` prices the feature on real traffic before it dispatches anything.

## Verification

`packages/llm/llm-cache-warm/tests/warmer.spec.ts` covers the window in both directions: no warm without a configured provider, an auxiliary purpose, an attachment, a small prefix, or outside a tool block; one logged warm per interval inside it; the ping, daily-budget, dry-run, and concurrency bounds; and the failure path. `packages/llm/token-meter` typechecks with the event folded into the usage projection, at `stateVersion: 3`.

Not covered: a recorded snapshot scenario. The plugin ships disabled, so no shipped profile produces `cache-warm/start` events, and warming is invisible on the model-visible surface by design.
