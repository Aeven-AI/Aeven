---
description: "The memory manager Remote: the signed-in user's memories, standing facts, and learned procedures, for maintainers of Settings → Memory."
kind: "package-reference"
---

# @aeven/api-memory-manager

English | [中文](README.zh.md)

## Summary

`avn-api-memory-manager` serves the `memoryManager` Remote namespace behind Settings → Memory. Every call acts for the caller of the running `/api` request (`ctx.identityUsers.actingUser()`), and a request without a signed-in user fails. It lists, edits, and forgets the caller's memories through `ctx.memory`, lists, reads, and corrects the caller's learned procedures through `ctx.memory.procedures`, and is the only writer of the caller's confirmed invariants, through `ctx.memoryInvariants`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The `avn-web-app` bundle mounts it after the memory rows. Methods:

- `memories({ query?, domains?, limit, offset })` returns one page, or `{ available: false }` while no memory provider runs. Each memory carries the working directory of the session it came from, when that session is still listed, so the page can group project memories by workspace. With `domains`, the page, its offset, and `total` count only memories in those domains.
- `editMemory(id, summary)` and `forgetMemory(id)` change only the caller's memories.
- `invariants()` returns the statements the caller confirmed as always true, with the characters their block costs and the bound it is rendered under, or `{ available: false }` while no `memory-invariants` row runs.
- `addInvariant(text)`, `editInvariant(id, text)`, and `removeInvariant(id)` write that document and return the caller's state after the attempt. A statement the block has no room for, one longer than the block, blank text, or an unknown identifier is refused with a reason instead of being written and dropped from the block.
- `procedures()` lists the caller's learned procedures, newest first and one per name, each with its description, domain, time, and the session and workspace it was learned in, or `{ available: false }` while no memory provider runs. It lists every workspace's procedures.
- `procedure(id)` adds the condensed procedure memory recall delivers and the full Markdown procedure.
- `editProcedure(id, summary)` replaces the condensed procedure; the stored full procedure stays as it was. A procedure is forgotten with `forgetMemory(id)`, since it is one memory.

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

### Edited memories and procedures

#### What the model sees

Nothing at the moment of the call: the pages, the change results, and the refusal reasons are browser payloads, and this package registers no prompt section, tool schema, or session event. What a call changes reaches a model later, through the consumer that owns that rendering — a corrected or forgotten memory is what the next recall and `memory_search` return, and an edited or forgotten learned procedure is what the next recall delivers, or no longer delivers, for that kind of task. Changes made here carry no session in their provenance.

#### Token effect

None in the call. A later request pays for the recalled text under the consumer's own bound, and a memory line edited here keeps its place in that budget.

#### KV Cache effect

None directly: an edit changes no assembled request. What a later turn recalls from it is append-only text in that turn's history.

## Known Limitations and Deferred Work

- Workspace grouping reads every listed session header per page request.

### Dev Note

**Runtime invariant:** No companion is published. Every read it serves comes from the owning service inside the same call, so the Remote keeps no state of its own and no second observation of it can diverge.
