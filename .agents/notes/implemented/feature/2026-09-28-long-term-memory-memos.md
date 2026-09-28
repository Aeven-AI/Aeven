# Agent Note: Long-term memory with a MemOS provider

Status: implemented

## Problem

Agents start every session with no memory of earlier work: user preferences, what worked in a repository or application, and which approaches failed. MemOS (`@memtensor/memos-local-plugin`) provides a local memory engine with layered traces, policies, world models, and skill crystallization, and ships an adapter for DeepSeek Harness. Aeven is a hard fork of DSH with rescoped `@aeven/*` packages, so that adapter's `@deepseek-ai/dsh-*` peer imports do not load here, and adopting it as-is would make MemOS's plugin the memory architecture.

## Decision

Aeven owns a complete capability seam in `packages/memory/`, and MemOS sits behind it as one provider:

- `@aeven/memory` defines `ctx.memory` in provider-neutral terms (scope, recall, turn capture, item reads) plus the `MEMORY_TOOL` names.
- `@aeven/memory-memos` ports the MemOS DSH adapter's MemOS half: bootstrap of the pinned `MemoryCore` (2.0.20), the per-session serial capture queue and MemOS session/episode lifecycle, the host-LLM bridge over `ctx.llm`, the hard recall deadline, and the loopback Viewer.
- `@aeven/memory-context` ports the adapter's host half: one recall per accepted direct-user turn at the first `agent/pre-step`, and turn assembly from committed session events handed to the provider at `turn/end`.
- [Outcome capture](2026-09-28-memory-outcome-capture.md) records retries, corrections, reported verification, and goal completion beside those turns.
- `@aeven/tool-memory` ports the six read tools under Aeven names.

The DSH adapter's behavior was kept where it encodes tested decisions: recall reads the downstream pre-step decision, only `user`-sourced messages trigger recall or capture, a surface replacement of a tool result is not a second execution, recall has a hard deadline independent of provider cancellation, auxiliary LLM calls request reasoning `off` when the route supports it and carry no session id, and autonomous recovery stays off when the Host bridge is the only LLM route.

### Model-visible text

Recalled context enters as a durable plugin-sourced `user/message` (`form: 'recall'`), so it is logged and replays verbatim; the Consumer owns the `<memory_context>` frame and escapes its closing tag. MemOS renders follow-up hints naming its own `memos_*` tools and `kind="world_model"`; the provider rewrites them to `MEMORY_TOOL` names and `world-model`, because the provider owns the text it returns.

### Per-user memory

Memory belongs to one signed-in account. The connection host runs each admitted `/api` request inside `ctx.identityUsers.runAsCaller`, and session creation records `actingUser().id` as `SessionHeader.owner`; forks and subagent sessions inherit it, and the JSONL persistence stores it. `MemoryScope.owner` is required, `memoryScopeOf` returns undefined for an ownerless session, and the MemOS provider maps each owner to its own profile (`user:<owner>`), so recall, capture, and reads never cross accounts. A session without an owner has no memory rather than a shared pool, which keeps later cloud sync per user.

### Memory domains

Each memory is `person`, `project`, `world`, or `experience`. MemOS stamps captured memory with a workspace key but neither classifies it nor filters recall by workspace, so the provider owns both: after each capture it asks the session's model for the turn's domain and records it as a `domain:` trace tag, and at recall it reads each trace hit's tag, workspace, and summary and drops project memory of other workspaces. `memory-context` renders the recalled hits itself, grouped by domain, which replaces MemOS's own rendered context and its instructions to treat memory as established knowledge.

### Memory operations

`ctx.memory` also lists, remembers, edits, forgets, and records feedback for the owner's memories. `edit` and `forget` check the trace's owner before calling MemOS, whose update and delete take an id alone, and `list` filters by owner across namespaces. `message-feedback` emits `message-feedback/changed` after a durable write, and `memory-context` turns a rating on a turn it captured into `ctx.memory.feedback`; per-agent instances handle only sessions they ran, so one rating is recorded once. The model gets `memory_remember` for facts the user explicitly asks it to keep.

### Composition

The web bundle mounts the `memory` slot on the host plane and the `memory-memos` provider disabled. The `standard`, `cordis`, and `ptc` presets mount `memory-context` and `tool-memory`. A preset mounts only when every row's injected services exist, so the slot is always present and the Consumers gate their prompt section and tools on `ctx.memory.whileActive`: enabling the provider row turns the feature on, and no memory tool or guidance appears without a provider.

## Consequences

- Memory is stored under `$AVN_HOME/memory` and inspected through the MemOS Viewer until Aeven has its own memory UI.
- MemOS adds native `better-sqlite3`, `onnxruntime-node`, and `sharp` builds (allowed in `pnpm-workspace.yaml`); desktop packaging does not ship them yet.
- MemOS traces store tool output, so text a tool read can reappear in later recalls. Recalled context is framed as untrusted data; per-source capture rules are deferred.
- Memories captured before per-user scoping sit in an ownerless preset profile that no account reads.
- The session-query SQLite index does not yet store `owner`; nothing that reads it needs the owner today.
- The agent kind passed to MemOS is `deepseek-harness`, because the embedded Viewer server keys its in-process host behavior on that value.
