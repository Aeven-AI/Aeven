---
description: "The memory group map: long-term memory recall, capture, and inspection across sessions, for users and maintainers enabling or extending it."
kind: "package-group"
---

# memory/ — long-term memory capability family

English | [中文](README.zh.md)

## Summary

The memory group gives agents memory that outlives a session. Each direct-user turn receives one bounded recall of relevant earlier work as a durable, source-labelled message; each completed turn is handed to the provider to learn from; the statements the user confirmed as always true lead every request of their owner as one bounded block; and the model can search and inspect memory with tools. Aeven owns the `ctx.memory` interface, the invariants document, and the model-visible text, and the MemOS provider runs the MemOS local core in the Host process behind it. The family is on in every composition, including a fresh install.

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Service Definition: one provider slot for recall, capture, and inspection, plus the shared memory tool names | `ctx.memory` |
| [`memory-memos/`](memory-memos/README.md) | MemOS provider: local SQLite memory, local embeddings, auxiliary LLM calls through `ctx.llm`, optional Viewer | registers on `ctx.memory` |
| [`memory-context/`](memory-context/README.md) | Per-turn recall as durable context and turn capture from the session log | — |
| [`memory-invariants/`](memory-invariants/README.md) | The user's confirmed invariants: the bounded block that leads every request of its owner | `ctx.memoryInvariants` |
| [`tool-memory/`](tool-memory/README.md) | Model-facing `memory_*` search and inspection tools | registers on `ctx.tools` |
| [`api-memory-manager/`](api-memory-manager/README.md) | `memoryManager` Remote behind Settings → Memory: the signed-in user's memories and learned capabilities | `ctx.memoryManagerController` |

## Enabling

The `avn-web-app` bundle mounts the `memory` slot and a disabled `memory-memos` row; the `standard`, `cordis`, and `ptc` agent presets mount `memory-context` and `tool-memory`; and the `avn-base` bundle mounts `memory-invariants`, so the block of statements the user confirmed is present in every profile whether or not a provider is registered. A preset mounts only when every row's injected services exist, so the slot is always present; the Consumers add prompt text and tools only while a provider is registered. Enable the provider in a profile patch:

```yaml
- id: memory-memos
  disabled: false
```

## Related documentation

- [Memory subsystem](../../docs/subsystems/memory.md) — the `ctx.memory` provider slot, its recall, capture, and inspection requests, and the `ctx.memoryManagerController` Remote behind Settings → Memory.
- [Long-term memory Agent Note](../../.agents/notes/implemented/feature/2026-09-28-long-term-memory-memos.md) — why Aeven owns the seam and how the MemOS DeepSeek Harness adapter was ported.

## Dev Note

None.
