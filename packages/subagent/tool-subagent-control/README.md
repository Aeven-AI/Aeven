---
description: "Global send_message, interrupt_agent, and list_agents tools for users and maintainers composing or debugging continuable-child control."
kind: "package-reference"
---

# @aeven/tool-subagent-control

English | [中文](README.zh.md)

## Summary

`avn-tool-subagent-control` provides tree-wide messaging and discovery, descendant interruption, and waiting for input. The same tools serve the root and its managed children. Tool installation does not choose whether delegation starts continuable work.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package with the subagent service and Agent registry. Discovery is a separate plugin a deployment can omit.

### Minimal configuration

Load the subagent service, a backend, the delegation tool, and this package. Adding the separate list plugin exposes all four tools:

```yaml
- name: '@aeven/subagent'
- name: '@aeven/subagent-spawn-in-process'
- name: '@aeven/tool-subagent'
  config:
    provider: spawn
    backgroundMode: continuable
- name: '@aeven/tool-subagent-control'
- name: '@aeven/tool-subagent-control/list-agents'
```

This package takes no configuration: the root plugin provides `send_message`, `interrupt_agent`, and `wait_agent`; the list plugin provides `list_agents`.

### send_message

Sends a message to the root or another continuable member of the same subagent tree by `agent_id`, including siblings and deeper descendants. A working target receives Steer input at its nearest step; an idle target starts a turn. A cold target resumes without activating its creation ancestors. The call returns the accepted `messageId`, never a reply. Invalid membership, an unavailable root, unsupported continuation state, or rejected admission reports failure.

### interrupt_agent

Stops only the target's current turn: queued messages stay parked until a later `send_message`, descendants keep running, and the child stays available for follow-ups. The call returns when the stop request is accepted, not when the target is quiet; interrupting an already-finished agent is an accepted no-op, and self, sibling, stale, and non-ancestor callers get errored results.

### wait_agent

Waits for the caller's next-step input without consuming it. Pending input returns immediately; agent messages, completion notices, and user steering end the wait. `timeout_ms` defaults to `30000` and accepts integers from `10000` through `3600000`. The result is `{ "timedOut": false }` for input or `{ "timedOut": true }` at timeout. Cancellation, Agent disposal, and plugin unloading end the wait with an error and remove its listeners and timer. Waiting does not start another agent.

### list_agents

Lists the root first, followed by continuable members in stable order. `descendants` (default) walks the whole tree and includes durable parent ids and depths; `children` shows only direct children of the root. Status is `running`, `idle`, or `ready`. One-shot children are omitted and unreadable branches appear as diagnostics. A child receives the same tree listing as its root.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains what the tools delegate to the subagent service; the observable behavior is covered in [Use this package](#use-this-package).

### Design concept

Thin adapters over `ctx.subagents.sendMessage()`, `interrupt()`, and the list projections; the tools perform no lifecycle routing. Residency, cold resume, and authorization belong to the service, and the tools pass the exact live calling agent (`exec.agent`) as both sender and authority.

### Delivery and signal ownership

The tool forwards its execution signal, which owns admission only until inbox acceptance. Once the target accepts a message, it cannot be cancelled through this tool. Every message is framed as `Agent <sender-id> sent a message:` and recorded with `{ kind: 'agent-message', form: 'relay', senderSessionId: sender.id }`; the service derives that attribution and never treats it as authority.

### Listing projection

`list_agents` derives the root id from the calling agent, reads the service catalog without a cursor, refines each candidate's status through the live Agent registry, and omits one-shot children because they cannot accept `send_message`. Diagnostics keep their positions in the descendants scope and never expose descriptor contents.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `send_message`, `interrupt_agent`, and `wait_agent` registration |
| [`src/list-agents.ts`](src/list-agents.ts) | `list_agents` registration: scopes, status refinement, projection |
| [`src/wait-agent.ts`](src/wait-agent.ts) | `wait_agent` input observation and wait lifetime |
| — | No runtime invariant companion is published; this model-facing adapter has no independent lifecycle stream; delivery and activation relations are owned by the subagent service it calls. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough; they move from the tool schemas to the continuation service behind them.

- [Subagent subsystem](../../../docs/subsystems/subagent.md) — continuable children, activations, inbox, interrupt, and follow-up authority.
- [avn-tool-subagent](../tool-subagent/README.md) — the delegation tool that starts continuable children.
- [Generated tool catalog](../../../docs/tool-catalog.md#aeventool-subagent-control) — the four tool schemas.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The generated [schemas](../../../docs/tool-catalog.md#aeventool-subagent-control): `send_message` takes `agent_id` and `message`; `interrupt_agent` takes `agent_id`; `list_agents` takes optional `scope`; `wait_agent` takes optional `timeout_ms`.

#### Token effect

Fixed schema cost per parent request.

#### KV Cache effect

Prefix-stable; the schema does not change at runtime.

### Interrupt result

#### What the model sees

`interrupt requested for agent <agent_id>` on acceptance. An unauthorized caller — self, sibling, stale, or non-ancestor — is an errored result naming the rejection; an absent or settled target still renders the acceptance line.

#### Token effect

One short acknowledgement per call; the interrupted turn's abort is visible only in the child's own transcript.

#### KV Cache effect

Append-only; each result follows the reusable request prefix.

### Delivery result

#### What the model sees

`message delivered to agent <agent_id>` on acceptance; canonical output carries the accepted `messageId`. A target outside the tree, unavailable root, or rejected admission produces an errored result.

#### Token effect

One short acknowledgement per call; the target's response never returns through this call. A child uses the same tool with its initial task's parent id to append selected content to parent history.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Listing result

#### What the model sees

The first line is `<id> [<status>] — root agent`. Other rows are `<id> [<status>] — <label>`; descendants scope adds ` parent=<id> depth=<n>`. Diagnostics retain their positions. Status describes activity rather than completion.

#### Token effect

Grows linearly with the listed continuable children — the whole tree under the `descendants` scope; there is no cursor or cap, so long-lived parents with many persisted children pay the full list each call.

#### KV Cache effect

Append-only; each result follows the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the control tools cannot observe or steer; they are current package constraints.

- **A delivered message has no independent result** — acceptance returns only its inbox `messageId`; later target work lands in that target's durable Session and is never collected through this tool. A reply is another explicitly addressed `send_message`, not this call's result.
- **Messaging stays within one live tree** — the root must remain live; only cold targets resume, and unrelated trees and one-shot targets reject messages.
- **Listing is a snapshot, not a delivery promise** — it may race publication, disposal, or a later message, and another process may activate a child this process reports as `ready`; cross-process accuracy requires a shared lease. `interrupt_agent` performs the authoritative live-lineage check itself, so discovery staleness cannot grant authority.
- **No pagination or deletion** — the complete stably ordered set is returned, and persisted children remain listed for as long as their sessions remain in persistence; a service-level bound or delete operation is a later product decision.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
