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
| `candidateTraces` | `20` | Trace candidates MemOS ranks for recall before Aeven orders them |
| `viewer` | `false` | Serve the MemOS Viewer and its read/write API over every owner's memory, without sign-in. Off unless a composition asks for it, and it logs a warning while it answers |
| `viewerPort` | `18801` | Viewer port |
| `viewerHost` | `127.0.0.1` | Viewer bind address; only loopback is accepted |

Domains are trace tags (`domain:person`, `domain:project`, `domain:world`). After each capture the provider asks the session's model which domain the turn belongs to; `remember` sets the domain directly, and an untagged trace counts as `person` when captured without a workspace and `project` inside one. The `world` classification requires a reusable operation or fact about a tool or environment rather than discussion of Aeven's design. MemOS experiences and skills are `experience`, world models are `world`. Recall reads each hit's trace for its domain, workspace, and summary: it drops project memory captured in another workspace, which MemOS retrieval does not filter. Automatic trace recall uses the stored summary, including outcome labels. Explicit searches return the trace whole: the stored summary, then the captured message the summary was distilled from, then stored tool inputs, outputs, and assistant answers. A missing summary retains the candidate snippet. Trace reads preserve the stored detail, subject to the [memory tools' output limit](../tool-memory/README.md). Memory is per signed-in user: every read and write uses the MemOS profile `user-<owner>` of the scope's owning account, so recall, capture, and the tools never cross accounts. All accounts share one database under `home`.

A turn-start query runs as written first. MemOS reads a long identifier in a query as a hard eligibility filter and keeps only candidates containing it verbatim, which is right for an identifier lookup and wrong for a topic query: one pasted session id or commit hash would otherwise return nothing and leave the turn with no memory. When the query-as-written pass yields no visible hit and the query holds tokens the core confirms exactly — a lowercase token of 16 characters or more containing `-`, `_`, `:`, or a digit, so ordinary compounds such as `long-term-memory` qualify — the provider retries once inside the same deadline with those tokens removed ([`src/query.ts`](src/query.ts)). Explicit searches keep the identifier, where it is the point.

The runtime root holds an optional MemOS `config.yaml` (shared MemOS core schema), `data/memos.db`, and `skills/`. A missing `config.yaml` uses MemOS defaults: the lightweight pipeline and the local `Xenova/all-MiniLM-L6-v2` embedder, which downloads on first use. Automatic recall and explicit `memory_search` use MemOS's turn-start candidate path to bypass its two-second relevance LLM filter; MemOS lightweight mode otherwise forces that filter on even when `retrieval.llmFilterEnabled` is false. Explicit search keeps the configured per-tier result limits unless its tool arguments override them. Aeven omits correction-tagged traces from automatic recall because those turns do not identify a durable rule or its referent; explicit search can still retrieve them as history. Setting `algorithm.lightweightMemory.enabled: false` in `config.yaml` enables policy induction, world models, and skill crystallization; with the Host LLM bridge, startup and periodic recovery then stay off because they run outside any session route.

## Understand the implementation

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config, MemOS bootstrap, Viewer, registration |
| [`src/runtime.ts`](src/runtime.ts) | `MemoryProvider` over `MemoryCore`: namespaces, per-session capture queue, MemOS session and episode lifecycle, tool-reference translation |
| [`src/host-llm.ts`](src/host-llm.ts) | MemOS `HostLlmBridge` over `ctx.llm` with an async-local per-session route |
| [`src/deadline.ts`](src/deadline.ts) | Hard deadline for foreground recall |
| [`src/query.ts`](src/query.ts) | Identifier predicate mirrored from the core, and the topic query used for the turn-start retry |
| [`src/domain.ts`](src/domain.ts) | Domain classification and the trace-tag vocabulary, including the tag naming a memory's replacement |

`list` spans MemOS namespaces with an owner filter, because the core's default namespace cannot see private owner memories, and drops any row of another owner; `edit` and `forget` read the trace in the owner's namespace and check its owner before calling MemOS, whose update and delete take an id alone. `feedback` maps a captured turn to its trace through an in-process table, so it applies to turns captured since the session last opened. Recall, including trace reads used to label the results, is bounded by the caller's budget; the deadline is enforced here as well as inside MemOS because a loading ONNX model can ignore cancellation. Captures run in a per-session serial queue; closing a session runs after its accepted captures, and disposal drains every queue before shutting the core down. MemOS renders follow-up hints naming its own `memos_*` tools; the runtime rewrites them to the `MEMORY_TOOL` names.

A captured turn that carries a correction records what it replaced. A correction answers the exchange before it, so the previous turn's trace is tagged `superseded:<replacement trace>` at capture; automatic recall leaves a superseded trace out, while explicit search returns it as history. The write runs on the capture queue, after `turn/end`, so it costs the request path nothing.

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

**Runtime invariant:** No companion is published. The traces, skills, and world models this provider serves are asserted by the provider's own integration specs against the MemOS core it embeds; the package publishes no separate runtime relation of its own.

</details>
