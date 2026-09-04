# Agent Note: The agent-preset roster is held by the plugin, not keyed off the context

Status: implemented

English | [中文](2026-09-04-held-agent-preset-roster.zh.md)

## Problem

Three surfaces read one deployment-wide roster, each through its own snapshot store, and each store's loading guard admits only its own read. Measured against the running server, a session page asked `agentPresets/list` three times on boot and once more on every hop between sessions, while the roster it asks about cannot change when the selected session does.

The per-hop read is the one that compounds. The chip and the header label load from a mount effect and live in the conversation scope, which navigation rebuilds; each hop remounted them and put the same question back on the wire.

## Decision

**One `AgentPresetRosterHolder`, constructed in `apply` and passed to each surface.**

`fresh()` reaches the Host and holds what it answers. `held()` returns the held roster, else joins a read in flight, else raises one. `invalidate()` retires both. `beginRosterRead` takes the read as an argument, so each surface states at its call site which it needs.

The management section reads fresh: it copies and deletes presets, and the roster it shows immediately afterwards has to be what the wire reports. The chip and the header label read held: they display the roster and never change it.

**The holder is passed, not looked up, because no value reached through a Cordis context can key a cache.** `ctx.remote` returns a new proxy object on every property access — `ctx.remote === ctx.remote` is false. A `WeakMap` keyed on it stores under one object and reads under another, so every lookup misses while appearing correct: the underlying service is genuinely shared, and a property written through any of those proxies is visible through all of them. Two earlier attempts keyed this way, passed their tests, and changed nothing on the wire.

**Nothing expires on a timer.** Every route that changes the roster announces itself and invalidates: a settings write, a copy, a delete, authoring a preset file, and a reconnect that may land on a Host whose roster moved. A change arriving by none of those is served stale until one does. A timer would add an interval nobody can reason about and would shorten that window rather than close it.

**A refusal is never held**, or a failure nobody can clear becomes what every later read inherits.

## Consequences

A hop costs one call instead of two, and the one that remains — `subagents/list` — names the session it is for. Boot drops from three roster reads to two, and from twenty calls to eighteen.

Freshness is a property of the call site. A new surface must choose, and choosing wrong is quiet: a management action reading held would show the roster as it stood before its own write. The two methods are named for what they do so the choice is legible where it is made.

`invalidate()` is the whole contract for staleness. A future route that changes the roster without calling it serves a stale one, and no test fails — the type system cannot see the obligation.

The wider lesson outlives this package: **a Cordis service is not an identity.** Anything keyed on one — a cache, a registry, a per-connection map — has the same defect and will fail the same silent way.

## Verification

Unit coverage is 100% on statements, branches, functions and lines for the package: the held answer serving later readers, a read joining one in flight, an invalidation forcing the Host, a fresh read superseding the held answer, an answer discarded because an invalidation landed under it, and a refusal that is not held.

The behaviour was then measured against the running server, which is what the two earlier attempts lacked. Before: every hop carried `agentPresets/list`. After: `subagents/list` alone on a steady-state hop, four calls instead of five on the heavier ones, and eighteen instead of twenty on load.

The management surface's tests are what pinned the fresh/held boundary: caching inside the shared read left a copy, a delete, and a revealed path reading the roster as it stood before the mutation.

## Alternatives considered

**A `WeakMap` keyed on `ctx.remote`.** Built twice, and wrong both times for the reason above. The failure is silent, which is what made it worth recording.

**Share only the read in flight.** Built and reverted: it collapses concurrent reads, and these arrive across mount waves rather than together.

**A time-to-live.** Rejected: a tunable the deployment cannot reason about, where the invalidation routes already cover every way the roster changes.

**One store owned by the plugin, with the surfaces subscribing.** The better shape and a larger change: each surface owns its own status and error state today, and folding those together redesigns the package rather than fixing what it asks the Host.
