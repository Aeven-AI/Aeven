---
description: "The MemOS memory provider for users and maintainers enabling, configuring, or debugging long-term memory."
kind: "package-reference"
---

# @aeven/memory-memos

## Summary

`avn-memory-memos` registers MemOS as the `ctx.memory` provider. It runs the pinned `@memtensor/memos-local-plugin` core (`MemoryCore`) in the Host process: memory lives in a local SQLite database, embeddings run locally through Transformers.js, and MemOS's auxiliary summary and filtering calls go through the owning session's `ctx.llm` route, so no second API key is configured. The MemOS Viewer optionally serves the same memory on a loopback port.

## Use this package

Mount it on the host plane beside `@aeven/memory`. The web bundle ships the row disabled with `home: !!js avnHomePath('memory')`.

```yaml
- id: memory-memos
  name: '@aeven/memory-memos'
  config:
    home: !!js avnHomePath('memory')
```

| Field | Default | Meaning |
|---|---|---|
| `home` | required | Absolute MemOS runtime root; `MEMOS_HOME` overrides it |
| `hostLlm` | `true` | Route MemOS LLM calls through the session's `ctx.llm` route when `config.yaml` names no provider |
| `capabilityTtlMs` | `600000` | How long a route's reasoning-effort capability stays cached |
| `language` | `auto` | Language of stored summaries and learned knowledge written through the Host bridge: `auto` detects English or Chinese from the text being summarized, or `en` / `zh` |
| `classifyDomains` | `true` | Classify each captured turn as person, project, or world memory with one short call on the session's route; needs `hostLlm` |
| `classifyTimeoutMs` | `15000` | Bound on one classification call |
| `candidateTraces` | `20` | Trace candidates MemOS ranks for turn-start recall before Aeven orders them |
| `viewer` | `true` | Serve the MemOS Viewer and its read/write API |
| `viewerPort` | `18801` | Viewer port |
| `viewerHost` | `127.0.0.1` | Viewer bind address; only loopback is accepted |

Domains are trace tags (`domain:person`, `domain:project`, `domain:world`). After each capture the provider asks the session's model which domain the turn belongs to; `remember` sets the domain directly, and an untagged trace counts as `person` when captured without a workspace and `project` inside one. The `world` classification requires a reusable operation or fact about a tool or environment rather than discussion of Aeven's design. MemOS experiences and skills are `experience`, world models are `world`. Recall reads each hit's trace for its domain, workspace, and summary: it drops project memory captured in another workspace, which MemOS retrieval does not filter. Project and world trace snippets include the stored tool inputs, outputs, and assistant answer alongside the summary; person traces use the summary. Memory is per signed-in user: every read and write uses the MemOS profile `user-<owner>` of the scope's owning account, so recall, capture, and the tools never cross accounts. All accounts share one database under `home`.

The runtime root holds an optional MemOS `config.yaml` (shared MemOS core schema), `data/memos.db`, and `skills/`. A missing `config.yaml` uses MemOS defaults: the lightweight pipeline and the local `Xenova/all-MiniLM-L6-v2` embedder, which downloads on first use. Turn-start recall bypasses MemOS's relevance LLM filter and gives the candidates to Aeven for final ordering; MemOS lightweight mode otherwise forces that filter on even when `retrieval.llmFilterEnabled` is false. Setting `algorithm.lightweightMemory.enabled: false` in `config.yaml` enables policy induction, world models, and skill crystallization; with the Host LLM bridge, startup and periodic recovery then stay off because they run outside any session route.

## Understand the implementation

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config, MemOS bootstrap, Viewer, registration |
| [`src/runtime.ts`](src/runtime.ts) | `MemoryProvider` over `MemoryCore`: namespaces, per-session capture queue, MemOS session and episode lifecycle, tool-reference translation |
| [`src/host-llm.ts`](src/host-llm.ts) | MemOS `HostLlmBridge` over `ctx.llm` with an async-local per-session route |
| [`src/deadline.ts`](src/deadline.ts) | Hard deadline for foreground recall |

`list` spans MemOS namespaces with an owner filter, because the core's default namespace cannot see private owner memories, and drops any row of another owner; `edit` and `forget` read the trace in the owner's namespace and check its owner before calling MemOS, whose update and delete take an id alone. `feedback` maps a captured turn to its trace through an in-process table, so it applies to turns captured since the session last opened. Recall is foreground work bounded by the caller's budget; the deadline is enforced here as well as inside MemOS because a loading ONNX model can ignore cancellation. Captures run in a per-session serial queue; closing a session runs after its accepted captures, and disposal drains every queue before shutting the core down. MemOS renders follow-up hints naming its own `memos_*` tools; the runtime rewrites them to the `MEMORY_TOOL` names.

Captured outcome evidence is stored in the trace's `contextHints`, indexed with `outcome:` tags, and appended to the trace summary returned by recall. Verification is labeled as the assistant's report; goal completion is labeled as a logged goal change. A durable goal completion also gives its trace positive implicit feedback. Failed tool calls remain in the trace and feed MemOS's tool-outcome path; a retry alone does not count as a failed task. Explicit message ratings continue to use the separate feedback operation.

## Model Experience

This provider adds no prompt text or tools of its own. Its recall context reaches the model only through `@aeven/memory-context`, and its read results only through `@aeven/tool-memory`.

## Known Limitations and Deferred Work

- **No Aeven-native memory UI** — inspection and deletion go through the MemOS Viewer until an Aeven settings surface exists.
- **Desktop packaging** — MemOS brings native `better-sqlite3`, `onnxruntime-node`, and `sharp` builds that the desktop packager does not yet rebuild or ship.
- **Capture provenance** — MemOS stores tool output in traces, so text a tool read can reappear in later recalls; recalled context is framed as untrusted data.

## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The MemOS agent kind is `deepseek-harness` because the embedded Viewer server keys its in-process host behavior on that value.

</details>
