---
description: "The memory manager Remote: the signed-in user's memories and learned capabilities, for maintainers of Settings → Memory."
kind: "package-reference"
---

# @aeven/api-memory-manager

English | [中文](README.zh.md)

## Summary

`avn-api-memory-manager` serves the `memoryManager` Remote namespace behind Settings → Memory. Every call acts for the caller of the running `/api` request (`ctx.identityUsers.actingUser()`), and a request without a signed-in user fails. It lists, edits, and forgets the caller's memories through `ctx.memory`, lists, reads, edits, retires, restores, and deletes the caller's learned capabilities through `ctx.capabilities`, and is the only writer of the caller's confirmed invariants, through `ctx.memoryInvariants`.

## Use this package

The `avn-web-app` bundle mounts it after the `capability` row. Methods:

- `memories({ query?, domains?, limit, offset })` returns one page, or `{ available: false }` while no memory provider runs. Each memory carries the working directory of the session it came from, when that session is still listed, so the page can group project memories by workspace. With `domains`, the page, its offset, and `total` count only memories in those domains.
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

### Promoted invariants

#### What the model sees

The statements the caller confirmed as always true, one per line inside the `<invariants>` block that every request of that account carries. The frame, the guidance sentence, and the bound belong to [`@aeven/memory-invariants`](../memory-invariants/README.md#model-experience), whose document this Remote is the only writer of: `addInvariant` puts a statement into the owner's next request, `editInvariant` replaces its line where it stands, and `removeInvariant` takes the line away. A refusal (`empty`, `too-long`, `full`, `missing`) is answered to the management page and reaches no request at all.

#### Token effect

None of its own: the block already sits in every request of its owner, and a write changes what it holds. `invariants()` reports the cost the page states before a promotion — the characters the content spends, the row's `maxChars`, and the longest text one statement may hold — because the same characters are paid again on every request of that account.

#### KV Cache effect

None for a request this package assembles, because it assembles none. A write changes the invariants block, so the section that carries it differs from the owner's next request onward and reuse of a prefix that already included it ends there. The reads and page requests above change no request.

### Edited memories and capabilities

#### What the model sees

Nothing at the moment of the call: the pages, the change results, and the refusal reasons are browser payloads, and this package registers no prompt section, tool schema, or session event. What a call changes reaches a model later, through the consumer that owns that rendering — a corrected or forgotten memory is what the next recall and `memory_search` return, and an edited, retired, restored, or deleted capability changes the description and procedure the capability consumer recalls or a `capability_manage` read shows, with a trusted capability's edited revision needing a verified run before it is trusted again. Changes made here carry no session in their provenance.

#### Token effect

None in the call. A later request pays for the recalled text under the consumer's own bound, and a memory line edited here keeps its place in that budget.

#### KV Cache effect

None directly: an edit changes no assembled request. What a later turn recalls from it is append-only text in that turn's history.

## Known Limitations and Deferred Work

- Workspace grouping reads every listed session header per page request.

### Dev Note

**Runtime invariant:** No companion is published. Every read it serves comes from the owning service inside the same call, so the Remote keeps no state of its own and no second observation of it can diverge.
