---
description: "The memory manager Remote: the signed-in user's memories and learned capabilities, for maintainers of Settings → Memory."
kind: "package-reference"
---

# @aeven/api-memory-manager

## Summary

`avn-api-memory-manager` serves the `memoryManager` Remote namespace behind Settings → Memory. Every call acts for the caller of the running `/api` request (`ctx.identityUsers.actingUser()`), and a request without a signed-in user fails. It lists, edits, and forgets the caller's memories through `ctx.memory`, lists, reads, edits, retires, restores, and deletes the caller's learned capabilities through `ctx.capabilities`, and is the only writer of the caller's confirmed invariants, through `ctx.memoryInvariants`.

## Use this package

The `avn-web-app` bundle mounts it after the `capability` row. Methods:

- `memories({ query?, limit, offset })` returns one page, or `{ available: false }` while no memory provider runs. Each memory carries the working directory of the session it came from, when that session is still listed, so the page can group project memories by workspace.
- `editMemory(id, summary)` and `forgetMemory(id)` change only the caller's memories.
- `invariants()` returns the statements the caller confirmed as always true, with the characters their block costs and the bound it is rendered under, or `{ available: false }` while no `memory-invariants` row runs.
- `addInvariant(text)`, `editInvariant(id, text)`, and `removeInvariant(id)` write that document and return the caller's state after the attempt. A statement the block has no room for, one longer than the block, blank text, or an unknown identifier is refused with a reason instead of being written and dropped from the block.
- `capabilities()` lists capabilities with the run counts of their current revisions; `capability(name)` adds the procedure, the change history, and judged executions, newest first.
- `editCapability(name, { description, content })` saves a new revision with `source: 'user'`; a trusted capability then needs a verified run before it is trusted again.
- `setCapabilityStatus(name, 'retired' | 'learned')` withdraws a capability or puts it back in use; its evidence then decides the executable status. `deleteCapability(name)` removes it with its history.
- `capabilityVersions(name)` lists the revisions whose procedure is still kept, oldest first, and `rollbackCapability(name, revision)` restores one as a new revision, which then answers to its own evidence.

Changes made here carry no session in their provenance. A promoted invariant is the caller's own statement: it takes effect in their next request and outlives the memory that suggested it.

Config: `timeoutMs` (default 15000) bounds each memory provider call; `maxPageSize` (default 200) bounds one memory page.

## Model Experience

None. The Remote is user-facing only; edits reach the model through later recall and the skill catalog.

## Known Limitations and Deferred Work

- Memory listing pages newest first without a domain filter, so the client filters one loaded page by domain.
- Workspace grouping reads every listed session header per page request.

## Dev Note

**Runtime invariant:** No companion is published. Every read it serves comes from the owning service inside the same call, so the Remote keeps no state of its own and no second observation of it can diverge.
