---
description: "The model-facing long-term memory tools for users and maintainers enabling or tuning memory search."
kind: "package-reference"
---

# @aeven/tool-memory

English | [中文](README.zh.md)

## Summary

`avn-tool-memory` registers nine tools over `ctx.memory`: `memory_search` (bounded search across traces, policies, environment models, and skills), `memory_get` (one trace, policy, or world model), `memory_timeline` (an episode's ordered traces), `memory_list` (the person's earlier messages from every conversation, newest first, one per turn, paged by `offset` with an optional literal text filter; imported facts and learned procedures are left out unless `includeSaved` is set), `memory_environments`, `memory_skills`, `memory_skill` (loads a skill and records its use), `memory_remember` (stores a fact the user explicitly asked to be remembered, about the user, the current project, or general knowledge), and `memory_remember_bulk`. Search results carry each memory's domain. Tool names come from `MEMORY_TOOL` in `@aeven/memory`, the same names the provider's recall context points to.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount it per agent (the `standard`, `cordis`, and `ptc` presets include it) beside a host `memory` slot. The tools are registered only while a memory provider is registered, and read only the session owner's memory; in a session without an owner they fail with an error that memory needs a signed-in user.

| Field | Default | Meaning |
|---|---|---|
| `resultMaxChars` | `1200` | Maximum characters of each body or snippet a tool returns |
| `searchTimeoutMs` | `3000` | Hard budget for one `memory_search`; an overrun returns no results with `timedOut: true` |
| `listTextMaxChars` | `300` | Maximum characters of each message `memory_list` returns |
| `listDefaultLimit` | `100` | Messages on a `memory_list` page when the call names no limit |
| `listMaxLimit` | `200` | Most messages one `memory_list` page may hold |

`memory_remember_bulk` imports facts verbatim with batched embeddings and no per-fact summarization. With `file` it reads a `.jsonl` file of `{"fact", "about"?, "date"?}` lines (`about`: `user`, `project`, or `knowledge`, which files general knowledge such as facts about a product) or a `.txt` file of one fact per line itself, so the model neither rewords nor drops facts; with `facts` it takes at most `bulkMaxFacts` strings. Facts the memory already holds with the same text are skipped, so importing a file again is safe, and the result states how many were written, skipped, and not facts. Both memory-writing tools preserve attribution, dates and uncertainty in the supplied text; advertised claims, plans and assessments must not be stored as verified observations. `memory_remember` accepts the same `user`, `project` and `knowledge` categories.

## Model Experience

### Memory tools

#### What the model sees

Nine tool schemas. `memory_search` tells the model that each direct-user turn already received one automatic recall and to search only to rephrase or broaden it, and that a search by meaning cannot go through everything the person asked. `memory_list` is for questions about what the person asked or said over time; the model pages it until it has covered the period and lists before saying earlier messages are unavailable. Results are text plus JSON facts, each body clipped to `resultMaxChars`.

#### Token effect

Six fixed schemas in every request; each result is bounded by `resultMaxChars` per item.

#### KV Cache effect

Static schemas; results are append-only tool results.

## Known Limitations and Deferred Work

- **No model-driven correction or deletion** — the model can add a fact with `memory_remember` but cannot edit or forget memory; `ctx.memory.edit` and `forget` serve product surfaces.
- **No invariant companion** — No runtime invariant companion is published because the seven tools only read through `ctx.memory` and are registered while that provider is active, so every stored trace, policy, and skill belongs to `@aeven/memory` and a check here could only restate that provider's own state.

### Dev Note

None.
