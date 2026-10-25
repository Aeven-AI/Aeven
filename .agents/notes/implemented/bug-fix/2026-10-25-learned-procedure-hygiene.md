# Agent Note: Learned-procedure hygiene

Status: implemented

English | [中文](2026-10-25-learned-procedure-hygiene.zh.md)

## Problem

Learned procedures are distilled from tool output and recalled into the owner's later requests, but neither the memory store nor the capability registry inspected their content, so a token a tool printed could be stored and replayed. The merge prompt told the model to keep every file and command and to keep the instances as examples, and distillation folded each instance in as an example, so procedures grew with every merge. `store: memory` loaded without the memory service and failed only when the background learner first called it.

## Decision

`@aeven/capability` owns one deterministic redactor, `redactSecrets`, for known token formats, private-key blocks, URL user info, `Bearer`/`Basic` values, and credential-shaped values of credential-named keys; placeholders and paths are kept. The registry applies it in `save`, `patch`, and `writeFile`, including the origin's request, and `storeLearnedProcedure` applies it to the memory text and summary. Merge and distillation keep what holds for the kind of task, turn instance values into placeholders, and add no instances; a merge is no longer than its longest member. A procedure carries a "Facts" section for what the work verified about the workspace or application, stated literally, because a placeholder would discard exactly what the next run would otherwise search for again; a merge keeps each verified fact no newer procedure contradicts and states when to take a step only some procedures took. `tool-capability` refuses to load with `store: memory` when no memory service is mounted.

## Alternatives considered

**Redacting every memory write** would also rewrite facts the user explicitly asked to be remembered, which is a product decision outside learned procedures. **Rejecting a procedure that contains a credential** loses an otherwise useful procedure that a placeholder repairs. **A model-based secret check** adds a model call to every write for a problem that format matching covers.

## Consequences

Redaction and the load check add no model calls and run on background write paths. Matching favours precision, so a credential in an unrecognized format and an unlabeled short value still pass. Procedures stored before this change keep their content until they are rewritten. `scripts/benchmark-learning.ts` mounts `tool-capability` without memory and now fails at load instead of measuring a learner that cannot write.
