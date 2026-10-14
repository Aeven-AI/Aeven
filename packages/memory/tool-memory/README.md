---
description: "The model-facing long-term memory tools for users and maintainers enabling or tuning memory search."
kind: "package-reference"
---

# @aeven/tool-memory

English | [中文](README.zh.md)

## Summary

`avn-tool-memory` registers seven tools over `ctx.memory`: `memory_search` (bounded search across traces, policies, environment models, and skills), `memory_get` (one trace, policy, or world model), `memory_timeline` (an episode's ordered traces), `memory_environments`, `memory_skills`, `memory_skill` (loads a skill and records its use), and `memory_remember` (stores a fact the user explicitly asked to be remembered, about the user or about the current project). Search results carry each memory's domain. Tool names come from `MEMORY_TOOL` in `@aeven/memory`, the same names the provider's recall context points to.

## Use this package

Mount it per agent (the `standard`, `cordis`, and `ptc` presets include it) beside a host `memory` slot. The tools are registered only while a memory provider is registered, and read only the session owner's memory; in a session without an owner they fail with an error that memory needs a signed-in user.

| Field | Default | Meaning |
|---|---|---|
| `resultMaxChars` | `1200` | Maximum characters of each body or snippet a tool returns |
| `searchTimeoutMs` | `3000` | Hard budget for one `memory_search`; an overrun returns no results with `timedOut: true` |

## Model Experience

### Memory tools

#### What the model sees

Seven tool schemas. `memory_search` tells the model that each direct-user turn already received one automatic recall and to search only to rephrase or broaden it. Results are text plus JSON facts, each body clipped to `resultMaxChars`.

#### Token effect

Six fixed schemas in every request; each result is bounded by `resultMaxChars` per item.

#### KV Cache effect

Static schemas; results are append-only tool results.

## Known Limitations and Deferred Work

- **No model-driven correction or deletion** — the model can add a fact with `memory_remember` but cannot edit or forget memory; `ctx.memory.edit` and `forget` serve product surfaces.
- **No invariant companion** — No runtime invariant companion is published because the seven tools only read through `ctx.memory` and are registered while that provider is active, so every stored trace, policy, and skill belongs to `@aeven/memory` and a check here could only restate that provider's own state.

### Dev Note

None.
