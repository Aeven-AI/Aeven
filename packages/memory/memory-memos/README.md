---
description: "The MemOS memory provider for users and maintainers enabling, configuring, or debugging long-term memory."
kind: "package-reference"
---

# @aeven/memory-memos

English | [中文](README.zh.md)

## Summary

`avn-memory-memos` registers MemOS as the `ctx.memory` provider. It runs the vendored MemOS core (`MemoryCore`, [`@deepseek-ai/memos-local-plugin`](../../../vendor/memos-local-plugin)) in the Host process: memory lives in a local SQLite database, embeddings run locally through Transformers.js, and MemOS's auxiliary summary and filtering calls go through the owning session's `ctx.llm` route, so no second API key is configured. Each account has its own MemOS core over its own database, opened on the account's first memory operation.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount it on the host plane beside `@aeven/memory`. The web bundle ships the row with `home: !!js avnHomePath('memory')` and `accounts: !!js avnHomePath('accounts')`.

```yaml
- id: memory-memos
  name: '@aeven/memory-memos'
  config:
    home: !!js avnHomePath('memory')
    accounts: !!js avnHomePath('accounts')
```

| Field | Default | Meaning |
|---|---|---|
| `home` | required | Absolute MemOS runtime root holding the `config.yaml` every account's core uses; `MEMOS_HOME` overrides it |
| `accounts` | required | Absolute directory of per-account subtrees; an account's MemOS data lives in `<accounts>/<sha256 of the account id>/memory` |
| `hostLlm` | `true` | Route MemOS LLM calls through the session's `ctx.llm` route when `config.yaml` names no provider |
| `capabilityTtlMs` | `600000` | How long a route's reasoning-effort capability stays cached |
| `language` | `auto` | Language of stored summaries and learned knowledge written through the Host bridge: `auto` detects English or Chinese from the text being summarized, or `en` / `zh` |
| `classifyDomains` | `true` | Classify each captured turn as person, project, or world memory and detect corrections on the session's route, inside the turn's final-reply summarize request; needs `hostLlm` |
| `classifyTimeoutMs` | `15000` | Bound on one fallback classification call |
| `candidateTraces` | `40` | Trace candidates MemOS ranks for recall before the relevance judgment chooses among them; a wide pool keeps facts that logs mentioning the same names would otherwise crowd out |
| `maxTextChars` | `16000` | Longest request or reply text one memory stores; longer text keeps its beginning and end, so this bounds a learned procedure `memory_get` reads back |
| `learning` | `true` | Run MemOS's learning pipeline — reward scoring, policy induction, world models, skill crystallization, and feedback — on each closed episode; `false` keeps the lightweight capture-and-recall pipeline. Overrides `algorithm.lightweightMemory.enabled` in `config.yaml` |
| `embedding` | `Xenova/multilingual-e5-small`, `query: ` / `passage: `, `cpu`, `q8`, `maxInputTokens` 512 | Local embedding model, role prefixes, transformers.js device and precision, and estimated tokens per embedded piece, kept within E5's 512-token window. `embedding.similarity` sets MemOS's cosine cutoffs on the model's own scale — recalled traces 0.84, episode goals 0.86, policy association 0.94, feedback merge 0.93, world-model clustering 0.91 — mapped from MemOS's MiniLM defaults by matching the share of memory pairs each cutoff keeps, because E5 scores unrelated texts near 0.8. Overrides `config.yaml`'s `embedding` model fields while that file keeps the `local` provider. A changed model, prefix, or piece size re-embeds each account's stored memory once, in the background, when its core opens |
| `reindexBatchSize` | `100` | Vectors re-embedded per batch during that re-index; while an account's index is rebuilt its turn-start recall is skipped and marked degraded, and the new fingerprint is recorded only when no vector failed |
| `relevanceTimeoutMs` | `2500` | Longest the turn-start relevance judgment may take inside the recall budget; on failure or timeout at most two mechanically ranked memories are delivered and the recall is marked degraded |
| `minEpisodesForInduction` | `2` | Separate episodes that must support a pattern before MemOS induces a policy (`l2Induction.minEpisodesForInduction`) |
| `candidatePolicies` | `false` | Recall `candidate` policies beside `active` ones (`retrieval.includeCandidatePolicies`) |
| `skillsPerTurn` | `1` | MemOS Skills one recall delivers at most (`retrieval.tier1TopK`) |

Turn-start recall is judged by one model call on the session's route instead of MemOS's own filter: it sees the request, the earlier conversation, and each candidate's kind (fact, exchange, log, procedure, episode, skill, knowledge), domain, age, and procedure status, decides whether the person lane or the task lane leads, may keep nothing, and reports whether the person is sharing their life. Logs — turns the capture judgment marks `kind:log`, and older summaries that read as an action record — are offered as logs. Archived procedures are never offered. `rememberMany` imports facts verbatim, skips text the owner already holds, and tags imports `source:import` (and `imported:undated` without an original date, whose trace time then reads as unknown age); imported facts stay out of the recent-memory candidates. `turnDomain` reports the domain a captured turn was filed under, and `setProcedureStatus` sets a learned procedure's `procedure:<status>` tag. Work complaints remain task requests even when angry. The judgment checks each candidate's content, including personal history inside experience episodes, and excludes unrelated personal history. Capture summaries retain attribution, dates and uncertainty for advertised claims, plans and assessments.

Domains are trace tags (`domain:person`, `domain:project`, `domain:world`). The session's model files each captured turn in the same request that writes its stored summary: the summarize request that carries the turn's assistant reply (lightweight capture summarizes the whole turn as one step; full capture gives tool sub-steps no assistant text) also receives the domain rules, the session's project, and the reply the user message answered, so its JSON answer adds `domain` and `corrects` next to `summary` ([`src/domain.ts`](src/domain.ts)). When that request did not run through the Host bridge or its answer names no domain, one short classification call runs after capture instead. `remember` sets the domain directly, and an untagged trace counts as `experience` when captured without a workspace and `project` inside one. The `world` classification requires a reusable operation or fact about a tool or environment rather than discussion of Aeven's design. MemOS experiences and skills are `experience`, world models are `world`. Recall reads each hit's trace for its domain, workspace, and summary: it drops project memory captured in another workspace, which MemOS retrieval does not filter. Automatic trace recall uses the stored summary, including outcome labels. Explicit searches return the trace whole: the stored summary, then the captured message the summary was distilled from, then stored tool inputs, outputs, and assistant answers. A missing summary retains the candidate snippet. Trace reads preserve the stored detail, subject to the [memory tools' output limit](../tool-memory/README.md). Memory is per signed-in user: every operation runs on the core of the scope's owning account, over that account's own database, and still uses the MemOS profile `user-<owner>`, so recall, capture, and the tools never cross accounts. The embedding model is loaded once per process and shared by every core; each open core keeps its own SQLite connection, embedding cache, and background timers.

The MemOS core is vendored as [`@deepseek-ai/memos-local-plugin`](../../../vendor/memos-local-plugin), whose [local modifications](../../../vendor/README.md#local-modifications) change capture and retrieval. The summarizer names whom each fact is about and takes facts about the user or people they know only from the user's words, so a stored summary never attributes a name without its owner and an assistant's answer is not stored as a user fact; the summary is what MemOS embeds, so it is fixed where it is written rather than rewritten afterwards. The Host provider forwards the MemOS operation name to the bridge, which is how the final-reply summarize request is recognized. Vector scans use the storage scan limit rather than a limit derived from the number of returned candidates, so recent facts remain searchable as the database grows. Vector candidates use the configured minimum similarity; repeated questions do not raise that minimum. The short-token pattern channel excludes common English function words.

A turn-start query runs as written first. MemOS reads a long identifier in a query as a hard eligibility filter and keeps only candidates containing it verbatim, which is right for an identifier lookup and wrong for a topic query: one pasted session id or commit hash would otherwise return nothing and leave the turn with no memory. When the query-as-written pass yields no visible hit and the query holds tokens the core confirms exactly — a lowercase token of 16 characters or more containing `-`, `_`, `:`, or a digit, so ordinary compounds such as `long-term-memory` qualify — the provider retries once inside the same deadline with those tokens removed ([`src/query.ts`](src/query.ts)). Explicit searches keep the identifier, where it is the point.

The runtime root holds an optional MemOS `config.yaml` (shared MemOS core schema), `data/memos.db`, and `skills/`. A missing `config.yaml` uses MemOS defaults, except that the local embedder is the multilingual `Xenova/multilingual-e5-small` at `q8` (about 118 MB, downloaded on first use) with E5's `query: ` and `passage: ` prefixes; each account's `data/embedding-index.json` records the rebuild version, model, prefixes, and piece size that indexed its vectors, and a core opened under different ones rebuilds every vector through MemOS `rebuildEmbeddings` while recall keeps using the old vectors, recording the new values only after the rebuild completes; the `learning` field, not `config.yaml`, chooses between the full and the lightweight pipeline. Automatic recall and explicit `memory_search` use MemOS's turn-start candidate path. Automatic recall keeps its relevance LLM filter, one call on the session's route capped at two seconds that drops candidates sharing words with the turn without being about it, and falls back to the mechanical ranking when the call fails or runs out of time; explicit search bypasses the filter, since the model chose its query. MemOS lightweight mode forces that filter on even when `retrieval.llmFilterEnabled` is false. Explicit search keeps the configured per-tier result limits unless its tool arguments override them. Aeven omits correction-tagged traces from automatic recall because those turns do not identify a durable rule or its referent; explicit search can still retrieve them as history. A turn's trace is superseded only when the next user message says a fact the reply stated is wrong; a complaint about how the work went or a repeated instruction leaves it recallable, because that turn often holds the user's own instruction. With `learning` on and the Host LLM bridge, reward, induction, and feedback run on the owning session's route, while startup and periodic recovery stay off because they run outside any session route.

## Understand the implementation

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config, per-account MemOS bootstrap, registration |
| [`src/cores.ts`](src/cores.ts) | One lazily opened MemOS core per account |
| [`src/migrate.ts`](src/migrate.ts) | One-time split of the shared database of earlier builds into per-account databases |
| [`src/runtime.ts`](src/runtime.ts) | `MemoryProvider` over `MemoryCore`: namespaces, per-session capture queue, MemOS session and episode lifecycle, tool-reference translation |
| [`src/host-llm.ts`](src/host-llm.ts) | MemOS `HostLlmBridge` over `ctx.llm` with an async-local per-session route |
| [`src/deadline.ts`](src/deadline.ts) | Hard deadline for foreground recall |
| [`src/query.ts`](src/query.ts) | Identifier predicate mirrored from the core, and the topic query used for the turn-start retry |
| [`src/domain.ts`](src/domain.ts) | Turn judgment and fallback domain classification, and the trace-tag vocabulary, including the tag naming a memory's replacement |

`list` spans the namespaces of the owner's database with an owner filter, because the core's default namespace cannot see private owner memories, and drops any row of another owner. MemOS filters `domains` and project-workspace visibility in SQLite using the stored domain tags and untagged workspace inference; unsearched pages read only their requested rows, and totals count matching rows without loading trace payloads; `edit` and `forget` read the trace in the owner's namespace and check its owner before calling MemOS, whose update and delete take an id alone. `feedback` maps a captured turn to its trace through an in-process table, so it applies to turns captured since the session last opened. Recall, including trace reads used to label the results, is bounded by the caller's budget; the deadline is enforced here as well as inside MemOS because a loading ONNX model can ignore cancellation. Captures run in a per-session serial queue; closing a session runs after its accepted captures, and disposal drains every queue before shutting the core down. MemOS renders follow-up hints naming its own `memos_*` tools; the runtime rewrites them to the `MEMORY_TOOL` names.

A turn judgment that identifies a specific replacement fact tags the previous exchange's trace `superseded:<replacement trace>` at capture; automatic recall leaves that exchange out, while explicit search returns it as history. A correction phrase alone does not supersede it. Independently remembered facts remain current because a turn-level judgment does not identify which fact in a batch was replaced; edit or forget an incorrect fact explicitly. The write runs on the capture queue after `turn/end`.

Captured outcome evidence is stored in the trace's `contextHints`, indexed with `outcome:` tags, and appended to the trace summary returned by recall. Verification is labeled as the assistant's report; goal completion is labeled as a logged goal change. A durable goal completion also gives its trace positive implicit feedback. Failed tool calls remain in the trace and feed MemOS's tool-outcome path; a retry alone does not count as a failed task. Explicit message ratings continue to use the separate feedback operation.

## Model Experience

### Automatic recall text

#### What the model sees

For each trace a turn-start recall returns, the text that reaches the model is that trace's stored summary, which `@aeven/memory-context` frames into one line of its recalled block; a trace whose summary is missing falls back to the MemOS injected context with its `memos_*` follow-up hints rewritten to the `MEMORY_TOOL` names, and outcome evidence stored with the trace is appended to the summary. A trace tagged with a correction or superseded by a later memory is left out of automatic recall, and a project trace captured in another workspace is dropped before it is returned.

#### Token effect

The recalled line costs the summary it carries, under the budget of the caller — one line is bounded by `itemMaxChars` and the whole block by `contextMaxChars` in `@aeven/memory-context`. What this provider puts behind those lines is bounded where it is written: `maxTextChars` (`16000`) caps the request or reply text one memory keeps, and automatic recall ranks at most `candidateTraces` (`20`) candidates before Aeven orders them.

#### KV Cache effect

Append-only: this provider contributes no system-prompt section and no tool schema, so the recalled lines join the conversation after the user's message and an earlier request's reusable prefix is unchanged.

### Explicit trace reads

#### What the model sees

A deliberate `memory_search` or `memory_get` returns the trace whole, in the order a reader needs it: the stored summary, then `User message: <the captured message the summary was distilled from>`, then `Tool record: <each tool's name, arguments, output, and error code>`, then `Assistant answer: <the captured reply>`, with the parts the trace does not hold left out. `@aeven/tool-memory` renders that text into the model's tool result.

#### Token effect

Bounded where the consumer bounds it: `@aeven/tool-memory` clips each body to its own `resultMaxChars`, and the detail this provider stores is capped by `maxTextChars` (`16000`) per request or reply text. An explicit search keeps the configured per-tier result limits unless the tool arguments override them.

#### KV Cache effect

Append-only: the read is one tool result in the conversation, and it changes no earlier request.

### Auxiliary memory requests

#### What the model sees

MemOS's own summarize, filter, and classification calls run on the session's route through the host bridge and carry no session id, so they are not conversation turns and trigger no session checkpoint. Their system text is MemOS's prompt with this provider's closing language rule appended — `Write every natural-language value in English.` or `Write every natural-language value in Simplified Chinese (zh-CN).` — and the request that summarizes a captured turn's final reply is extended with `PROJECT: <the session's working directory, or none>`, with `PREVIOUS ASSISTANT: <the reply the user message answers>` when that turn was captured in this process, and with the domain and correction rules. A capture whose summarize request did not run through the bridge, or answered without a domain, gets one classification call instead, whose whole input is the frame below.

##### Verbatim classification input frame

```markdown
PROJECT: <the session's working directory, or none>

USER: <the turn's user text, at most 1500 characters>

ASSISTANT: <the turn's assistant text, at most 1500 characters>

SUMMARY: <the stored summary, at most 300 characters>
```

#### Token effect

One auxiliary request per captured turn, plus one classification call per fallback, each outside the conversation's own requests and each bounded by its own limit: the classifier answers within `maxTokens` `40` and `classifyTimeoutMs` (`15000`), and reasoning is switched off for these calls when the route supports it.

#### KV Cache effect

None for the conversation: each call is a separate request with its own messages, so it neither reads nor extends the conversation's reusable prefix.

## Known Limitations and Deferred Work

- **Shared-database split** — the first start after per-account memory moves each account's rows out of `home/data/memos.db` into its own database and renames the shared file to `memos.db.split`; the split goes away at the first tagged release.
- **Capture provenance** — MemOS stores tool output in traces, so text a tool read can reappear in later recalls; recalled context is framed as untrusted data.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The MemOS agent kind is `deepseek-harness`, which the MemOS Viewer server keys its in-process host behavior on; stored rows carry it, so it stays fixed.

**Runtime invariant:** No companion is published. The traces, skills, and world models this provider serves are asserted by the provider's own integration specs against the MemOS core it embeds; the package publishes no separate runtime relation of its own.

</details>
