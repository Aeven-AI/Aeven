---
description: "Denies effect-capable tools that bypass the filesystem sandbox while a session's access mode forbids them, for users and maintainers who need a read-only session to hold."
kind: "package-reference"
---

# @aeven/tool-call-access-policy

English | [中文](README.zh.md)

## Summary

A `read-only` session still has routes to an effect. The filesystem sandbox refuses every write that routes through the fs capability, so `write` and `edit` fail — but a tool that clicks a live page, types into it, runs a terminal command, or powers a device never reaches that layer. `avn-tool-call-access-policy` closes those routes: it registers a monotonic `tools.guard()` check that denies the configured tools while the session's resolved access mode is the forbidden one. The denial names the tool, the mode, and what authorizes the call, so the model asks instead of retrying. It ships enabled in the `avn` base bundle with `read-only` as the forbidden mode.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The common path is one line: add the plugin to the composition — the `avn` base bundle already has it. The user controls the outcome through the session's access mode, not through the plugin's configuration.

### When to choose it

Choose it when a session's access mode must hold against effects the filesystem sandbox cannot see, which is what makes a "look, don't touch" instruction enforceable rather than advisory. Avoid it when every route must stay open, and remember what it does not do: it cannot deny a preference with no observable trigger, and it enforces nothing while the session's mode is permissive.

### Setting it up

Mount the plugin with its defaults:

```yaml
- name: '@aeven/tool-call-access-policy'
```

| Field | Default | Meaning |
|---|---|---|
| `mode` | `read-only` | Access mode in which the listed tools are denied |
| `deny` | the browser, terminal, and device tools | Tool names denied while the mode matches |

Narrow or extend `deny` from `cordis.yml`; an empty list disables the policy, which is a deliberate deployment choice rather than a silent default. The access mode itself comes from the session (`ctx.sandboxPolicy.resolve()`), so the same deployment serves a working session and a read-only one.

### What you get

With the mode set to `read-only`, a call to any listed tool returns an error result naming the tool, the mode, and the authorizing action; the tool never executes. Under `workspace-write` or `danger-full-access` the same call runs unchanged, as does any tool that is not listed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Enforce where the action is visible.** The check is a `ctx.tools.guard()` registration, which sees the tool name, its arguments, and the agent scope before dispatch, and denies by returning a reason. Nothing about it reads model prose.
- **Layer with the filesystem policy, do not replace it.** `read-only` already denies file mutations structurally. This plugin covers the routes that never touch the fs capability, which is the gap a tool-level check fills.
- **The user owns the switch.** The mode is session state the user sets; the tool list is deployment configuration. A recalled memory reaches neither, so learned text cannot widen authority.
- **Zero-cost check.** The guard is a synchronous set lookup against an already-resolved policy: no provider call, no prompt text, no tokens.

### How a call is denied

One `tools.guard()` callback runs for every dispatch. It returns `undefined` — admitting the call — when the tool is not in `deny`, and again when `ctx.sandboxPolicy.resolve().mode` differs from the configured `mode`. Otherwise it returns the reason string, which the registry turns into the model-facing denial. Registration is an effect under `ctx.effect`, so stopping or updating the plugin removes the check.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `name`/`inject`/`Config`/`apply`, the guard registration and its default tool list |
| — | No runtime invariant companion is published; the plugin owns no package-local history or mutable relation beyond the guard registration it disposes. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Tools subsystem reference](../../../docs/subsystems/tools.md) — the guard and pre-execute seams this plugin registers on.
- [Filesystem sandbox](../../fs/fs-sandbox/README.md) — the layer that refuses mutations regardless of route.
- [guard group map](../README.md) — the sibling guard packages and the loop-hygiene family.

-----

<a id="model-experience"></a>
## Model Experience

### Denied tool result

#### What the model sees

No prompt and no schema. A denied call returns one error result: `<tool> acts outside the filesystem sandbox, which this session's "<mode>" access mode forbids; ask the user to raise the access mode to continue`. Every other call passes through untouched.

#### Token effect

Zero tokens while the mode is permissive. A denial adds one small error result and replaces whatever the tool would have produced.

#### KV Cache effect

Append-only; a denial is new trailing content and does not invalidate earlier cache entries.

## Known Limitations and Deferred Work

- **Only while the mode is set** — with `workspace-write` or `danger-full-access` the check admits everything; a session that never changed its mode has no protection beyond the filesystem policy.
- **Only observable rules** — a preference with no trigger in structured state ("be concise", "do not over-engineer") cannot be expressed as a guard.
- **A deny list, not an allow list** — a tool added by a plugin the list does not name is admitted; deployments that need the inverse enumerate their permitted tools in `deny`'s complement by listing everything else.
