---
description: "The long-term memory Service Definition for maintainers writing a memory provider or Consumer."
kind: "package-reference"
---

# @aeven/memory

English | [中文](README.zh.md)

## Summary

`avn-memory` provides `ctx.memory`, a slot for one long-term memory provider. Consumers call `recall`, `profile`, `capture`, `closeSession`, the read operations (`detail`, `timeline`, `environments`, `skills`, `useSkill`), and the owner's memory operations (`list`, `remember`, `edit`, `forget`, `feedback`) without knowing the backing implementation. `list` takes an optional `domains` filter; its page, offset, and total then count only memories in those domains. With `cwd`, `list` leaves out the project memory of every other workspace, as recall does. `procedures({ owner, cwd? })` lists the owner's learned procedures, newest first: memories whose text is `Learned procedure <name>: <description>` followed by the Markdown procedure, written by `@aeven/tool-capability`. `profile({ scope })` returns lasting knowledge drawn from all of the owner's person memories regardless of age: every recorded yearly date (`MemoryDate`: birth, wedding, death, or anniversary, with its year when known) and, once the provider distilled one, a profile text; the provider brings the profile up to date in the background on the scope's route. `memoryOriginLabel(hit, now)` adds how long ago a memory was recorded. `LEARNED_PROCEDURE_PREFIX` and `learnedProcedureOf(record)` expose that text form to the Settings manager. `edit` and `forget` act only on memories of the scope's owner. Every memory has a domain (`MemoryDomain`): `person` and `world` and `experience` memories are recalled in every session of the owner, `project` memories only in sessions of the workspace they were captured in, and providers return no other workspace's project memory. Memory belongs to one signed-in user: every `MemoryScope` carries the owning account id from `SessionHeader.owner`. It also exports `memoryScopeOf(agent)`, which derives that scope and the session's model route, and returns undefined for a session without an owner, so such a session has no memory; and `MEMORY_TOOL`, the model-facing tool names that provider-rendered recall context may reference.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount it on the host plane. A provider calls `ctx.memory.register(provider)` inside an effect; a second registration throws. `ctx.memory.active` reports whether a provider is registered, and every operation except `closeSession` throws `MemoryUnavailableError` without one. `ctx.memory.whileActive(setup)` keeps a contribution, such as tools or a prompt section, registered exactly while a provider is registered. Types live in [`src/types.ts`](src/types.ts).

`MemoryTurn.outcome` optionally carries retry codes, an explicit correction, reported verification with successful tool-call ids, and a completed goal objective. Providers may store or use this evidence; a reported verification is not an independently established pass.

## Model Experience

### Memory tool names

#### What the model sees

This package adds no prompt text, tools, or session events of its own; what it fixes for a model is the tool names and the recall scope below. `MEMORY_TOOL` fixes the names that provider-rendered recall context and hit snippets may direct the model to: `memory_search`, `memory_get`, `memory_timeline`, `memory_environments`, `memory_skills`, `memory_skill`, and `memory_remember`, with `memory_get` taking the `MemoryDetailKind` values `trace`, `policy`, and `world-model`. [`@aeven/tool-memory`](../tool-memory/README.md) registers those tools; this package owns only the names, so a provider's rendered text and the tools it names cannot drift apart.

#### Token effect

The constant adds nothing to a request by itself. Each name costs tokens only where a provider's own rendered text or a hit snippet uses it.

#### KV Cache effect

None; a name reaches a request only inside text some provider or consumer rendered, and that owner decides where it goes.

### Memory scope

#### What the model sees

`memoryScopeOf(agent)` derives the scope a provider answers within: the owning account from the session header, the session id, the working directory, and the session's model route. A recall returns only hits that scope may see — `person`, `world`, and `experience` memories in every session of the owner, a `project` memory only in sessions of the workspace it was captured in — and a session without an owner gets no scope, so no provider returns memory for it. A recall also reports `timedOut` when its foreground budget elapsed rather than exceeding it.

#### Token effect

The recalled text is whatever the provider returns within the caller's `MemoryRecallRequest` limits and `timeoutMs`; this package adds no tokens of its own to a request.

#### KV Cache effect

None here; whichever consumer renders the hits appends them to its own request, so this package never touches a prefix.

## Known Limitations and Deferred Work

- **One provider per composition** — there is no routing between several memory providers.
- **No invariant companion** — No runtime invariant companion is published because the provider slot and its `whileActive` contributions change only inside `register` and the disposer it returns, so a listener would drive the same registration it claims to verify; what reaches a model is decided by the registered provider, and that provider's own package covers its behavior.

### Dev Note

None.
