# Agent Note: Learned procedures merge and show in Settings

Status: implemented

English | [中文](2026-10-19-learned-procedures-merge-and-settings.zh.md)

## Problem

With `store: memory`, the learner found the procedures it could merge into through one memory recall of the turn's request. MemOS returns five traces by default, and the turn that had just been captured and the session's earlier turns match that request most closely, so the distillation usually saw no existing procedure and created a new name. One account held 706 procedures under 692 names, many of them single instances of one kind of task. Replacing a procedure forgot only the copies recall happened to return, so names were stored twice. Settings → Memory → Capabilities read the capability registry, which the memory store never writes, so it stayed empty. MemOS's trace repository also clamps one `list` call to 500 rows, so a text-filtered or domain-filtered memory listing saw only the newest 500 traces.

## Decision

`ctx.memory.procedures({ owner, cwd? })` lists every learned procedure of the owner from the memory text form `Learned procedure <name>: <description>` and the Markdown procedure, which `@aeven/memory` now owns with `LEARNED_PROCEDURE_PREFIX` and `learnedProcedureOf`. `list` takes `cwd`, which leaves out other workspaces' project memory as recall does, so the learner sees only procedures its session could recall.

Before each distillation the learner lists the session's procedures, ranks them by a recall that asks for 30 traces and by shared words, and sends up to 120 names with descriptions and the full text of three. The reply may name other procedures it now covers in `replaces`; the stored procedure replaces every memory under its name and every covered procedure. When a learned-from turn's session sees more than `consolidateAbove` (40) distinct procedures, whatever that turn teaches, the learner forgets older copies of each name, groups procedures of one kind of task in batches of up to 150 names, and merges each group with one model call, once per owner and workspace per process. Merges run on their own queue, so a session's learning and its `session/settle` never wait for them.

`memoryManager` drops the capability registry endpoints and serves `procedures()`, `procedure(id)`, and `editProcedure(id, summary)`; forgetting uses `forgetMemory`. The Capabilities tab lists the procedures with a search box and sits before Standing facts. The vendored MemOS `listTraces` and `countTraces` page through the repository (vendor modification 26).

## Alternatives considered

**Raise the recall limit only.** Rejected because recall ranks every memory of the owner, and conversation traces of the same work still crowd out the procedure; the full list makes the existing procedures visible regardless of rank.

**Send every procedure to each distillation.** Rejected because hundreds of descriptions would take most of the input budget on every learned turn; the ranked list is bounded and the background merge keeps the count small.

**Keep the capability registry pane beside a procedures pane.** Rejected because the shipped preset learns into memory only, and the registry pane would stay empty.

## Consequences

- The first qualifying turn after a restart whose session sees more than 40 procedures starts the background merge, which spends model calls on that session's route: a few grouping calls and one call per group.
- Procedures of one kind in different grouping batches stay apart until a later merge or a learned turn names them in `replaces`.
- The Memory tabs and text search reach memories older than the newest 500 traces.
