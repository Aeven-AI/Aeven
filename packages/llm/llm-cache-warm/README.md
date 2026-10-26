---
description: "Opt-in prompt-cache warmer for sessions that wait inside a tool call: replays the last conversation request with a one-token cap so the next step lands on a cached prefix, with logged usage and configured provider lifetimes."
kind: "package-reference"
---

# @aeven/llm-cache-warm

English | [中文](README.zh.md)

## Summary

A provider bills a cached prompt prefix only while the cache entry lives, and some providers clear it within hours — DeepSeek publishes no lifetime at all. A tool call that keeps the loop waiting for minutes therefore turns the next request into a full-price prefix read even though nothing in the conversation changed.

This plugin replays the session's last conversation request with a one-token output cap while a tool call is in flight, so the prefix stays cached and the tool result the loop appends next lands on it. It warms nothing while a session waits for a human, nothing on a provider without an interval entry, and nothing when the prefix is too small for a cache hit to matter. Every warm is logged with the usage the provider reported. It ships disabled and no shipped profile enables it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

### When to choose it

Choose it when a deployment runs long tool calls — builds, test suites, browser work, a subagent — on a provider whose prompt cache outlives one request but outlives neither a long wait nor the provider's own TTL. Warming is a bet: it pays when the cache survives the wait and the next request reuses it, and it costs a cached prefix read plus one output token each time it does not. It does not help a workload that is always model-bound, and it never warms a request the deployment has not priced.

### Minimal configuration

```yaml
- id: llm-cache-warm
  plugin: '@aeven/llm-cache-warm'
  config:
    providers:
      deepseek:
        intervalMs: 240000
      openrouter:
        intervalMs: 120000
        maxPings: 3
```

`intervalMs` must stay below the provider's cache lifetime, with room for one request's latency; a warm that lands after eviction pays full price for nothing. `excludeTools` defaults to `['ask_user_question']`, the one tool whose block is a human deciding rather than work in progress.

## Understand the implementation

### Design concept

Two listeners and one private state machine. `llm/stream` records the request a warm would replay — never an auxiliary call (`purpose` set), never a request carrying a file or image block, never one below `minPrefixChars` — and `tools/execute` opens the warming window for the duration of one tool call, counting nested sub-calls so a `run_code` program keeps one window rather than restarting it per binding call.

Inside the window a timer fires every `intervalMs`: it appends `cache-warm/start`, dispatches the captured request with `maxTokens: 1` through the same LLM waterfall, folds the stream into a `BlockAssembler` for usage, and appends `cache-warm/result` with that usage or the failure. The warm request carries no `sessionId` — it must not trigger a durable flush — and reuses the captured options unchanged, so the provider sees a byte-identical prefix.

Three bounds keep the spend predictable: `maxPings` per tool call, `maxConcurrentPings` across sessions, and `dailyPingBudget` per UTC day. A tool's own signal cancels an in-flight warm, so a block that ends early stops paying immediately.

Cache lifetimes are provider facts, so they are configuration, not constants: the plugin warms a provider exactly when the deployment gives that provider an interval.

### Source map

- `src/index.ts` — plugin identity, configuration schema, the two waterfall listeners, and the `SessionEventMap` members.
- `src/warmer.ts` — capture, window state, timer, dispatch, and the daily budget.
- `src/types.ts` — payload types for `cache-warm/start` and `cache-warm/result`.
- `@aeven/token-meter` — folds `cache-warm/result` usage into the session's `tokenUsage` totals, so warm spend appears wherever turn spend does.

## Further Exploration

- The measured pilot this design follows: `dsh-warm` 0.2.0 for the DeepSeek harness, which reports an idle-warming saving of $6.91 over 50 days against a $7.15 cost when a warm is blocked by a tool result.
- Cache lifetimes beyond DeepSeek's published "cleared within hours to days": check the provider's own documentation before setting `intervalMs`.

## Model Experience

### Warm request

#### What the model sees

Nothing. A warm's response is drained inside the plugin, so no assistant message, no tool call, and no prompt change reach the conversation. The two events are log-only: no model request is built from them and no projection renders them. A warm cannot start a turn, cannot steer the agent, and cannot appear in the transcript.

#### Token effect

One output token per warm plus a cached prefix read, for the whole captured prefix. The plugin spends that only under a configured provider, only inside a tool call, and only within the ping, concurrency, and daily budgets.

#### KV Cache effect

It exists to preserve the KV cache: the prefix is replayed byte-identically, output cap aside, so the entry refreshes instead of expiring. A warm is wasted work when the prefix has already been evicted, which is why `intervalMs` belongs below the provider's lifetime with margin.

## Known Limitations and Deferred Work

- **Idle warming is not implemented.** A session waiting for a human — the model has replied and nothing is in flight — is not warmed even though that is often the longest wait. The measurement that would justify it is the one `dsh-warm` made for its streaming mode; until a deployment reports it, the plugin stays inside tool blocks.
- **Provider lifetimes are hand-configured.** No shipped provider client publishes a prompt-cache TTL, so `intervalMs` is a deployment's own estimate rather than a value the adapter can supply.
- **A warm cannot re-upload files.** Requests carrying a file or image block are never captured, so a session that works through attachments warms nothing.
- **The prefix is measured, not counted.** `minPrefixChars` compares characters of the system prompt, tool schemas, and messages; a tokenizer would be more exact and is not worth a dependency here.
- **No cache metrics are read back.** The plugin records what a warm cost, not whether the following request hit; proving the saving needs the provider's own cache-hit counters.
