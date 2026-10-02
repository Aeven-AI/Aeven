---
description: "The long-term memory Service Definition for maintainers writing a memory provider or Consumer."
kind: "package-reference"
---

# @aeven/memory

## Summary

`avn-memory` provides `ctx.memory`, a slot for one long-term memory provider. Consumers call `recall`, `capture`, `closeSession`, the read operations (`detail`, `timeline`, `environments`, `skills`, `useSkill`), and the owner's memory operations (`list`, `remember`, `edit`, `forget`, `feedback`) without knowing the backing implementation. `list` takes an optional `domains` filter; its page, offset, and total then count only memories in those domains. `edit` and `forget` act only on memories of the scope's owner. Every memory has a domain (`MemoryDomain`): `person` and `world` and `experience` memories are recalled in every session of the owner, `project` memories only in sessions of the workspace they were captured in, and providers return no other workspace's project memory. Memory belongs to one signed-in user: every `MemoryScope` carries the owning account id from `SessionHeader.owner`. It also exports `memoryScopeOf(agent)`, which derives that scope and the session's model route, and returns undefined for a session without an owner, so such a session has no memory; and `MEMORY_TOOL`, the model-facing tool names that provider-rendered recall context may reference.

## Use this package

Mount it on the host plane. A provider calls `ctx.memory.register(provider)` inside an effect; a second registration throws. `ctx.memory.active` reports whether a provider is registered, and every operation except `closeSession` throws `MemoryUnavailableError` without one. `ctx.memory.whileActive(setup)` keeps a contribution, such as tools or a prompt section, registered exactly while a provider is registered. Types live in [`src/types.ts`](src/types.ts).

`MemoryTurn.outcome` optionally carries retry codes, an explicit correction, reported verification with successful tool-call ids, and a completed goal objective. Providers may store or use this evidence; a reported verification is not an independently established pass.

## Model Experience

This package adds no prompt text, tools, or session events.

## Known Limitations and Deferred Work

- **One provider per composition** — there is no routing between several memory providers.

## Dev Note

None.
