---
description: "The memory group map: long-term memory recall, capture, and inspection across sessions, for users and maintainers enabling or extending it."
kind: "package-group"
---

# memory/ — long-term memory capability family

## Summary

The memory group gives agents memory that outlives a session. Each direct-user turn receives one bounded recall of relevant earlier work as a durable, source-labelled message; each completed turn is handed to the provider to learn from; and the model can search and inspect memory with tools. Aeven owns the `ctx.memory` interface and the model-visible text, and the MemOS provider runs the MemOS local core in the Host process behind it. The family is on in every composition, including a fresh install.

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Service Definition: one provider slot for recall, capture, and inspection, plus the shared memory tool names | `ctx.memory` |
| [`memory-memos/`](memory-memos/README.md) | MemOS provider: local SQLite memory, local embeddings, auxiliary LLM calls through `ctx.llm`, optional Viewer | registers on `ctx.memory` |
| [`memory-context/`](memory-context/README.md) | Per-turn recall as durable context and turn capture from the session log | — |
| [`tool-memory/`](tool-memory/README.md) | Model-facing `memory_*` search and inspection tools | registers on `ctx.tools` |
| [`api-memory-manager/`](api-memory-manager/README.md) | `memoryManager` Remote behind Settings → Memory: the signed-in user's memories and learned capabilities | `ctx.memoryManagerController` |

## Enabling

The `avn-web-app` bundle mounts the `memory` slot and a disabled `memory-memos` row; the `standard`, `cordis`, and `ptc` agent presets mount `memory-context` and `tool-memory`. A preset mounts only when every row's injected services exist, so the slot is always present; the Consumers add prompt text and tools only while a provider is registered. Enable the provider in a profile patch:

```yaml
- id: memory-memos
  disabled: false
```

## Related documentation

- [Long-term memory Agent Note](../../.agents/notes/implemented/feature/2026-09-28-long-term-memory-memos.md) — why Aeven owns the seam and how the MemOS DSH adapter was ported.

## Dev Note

None.
