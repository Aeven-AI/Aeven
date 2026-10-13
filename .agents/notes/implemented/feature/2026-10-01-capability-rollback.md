# Agent Note: A capability can be restored from a kept revision

Status: implemented

English | [中文](2026-10-01-capability-rollback.zh.md)

## Problem

Every capability write already kept its procedure: `CapabilityStore.write` stores the revision's `SKILL.md` under `versions/<revision>.md`, so an execution stays attributable to the text it followed. Nothing could read those files. A capability whose current revision turned out worse than an earlier one — a learner rewrote a working procedure after a run that failed for unrelated reasons — could only be repaired by hand on disk or by rewriting the procedure from memory, and `capability.json` describes only the current revision, so the earlier description was not even visible.

## Decision

`@aeven/capability` reads the revisions it kept and restores one:

- `CapabilityStore.version(owner, name, revision)` reads one kept body with the description its frontmatter carried, and `versions(owner, name)` lists them oldest first. Both answer with nothing rather than throwing when nothing was kept, because a revision that was never written and a revision whose body is gone are the same fact to a caller.
- `Capabilities.versions(owner, name)` and `Capabilities.rollback(owner, name, revision, sessionId)` expose them. A restore writes the kept procedure and description as a **new** revision, so the history stays append-only, and its provenance records `action: 'rollback'` with `restored: <revision>`. The restored revision then answers to its own evidence like any other: `settle` may degrade or retire it, and a rollback does not inherit trust.
- `@aeven/api-memory-manager` serves `capabilityVersions(name)` and `rollbackCapability(name, revision)` over the `memoryManager` Remote, so Settings can offer the history instead of only the current procedure.

## Alternatives considered

- **Keep a separate revision ledger file.** The bodies are already on disk per revision; a second copy would be a second thing to keep consistent.
- **Restore in place, reusing the old revision number.** That would rewrite history and make a later execution unattributable to the text it ran against.
- **Carry trust across a restore.** The kept revision may have been trusted when it was current, but the surrounding procedure and its files have moved on; the evidence of the revision being replaced says nothing about the revision coming back.
- **Refuse a restore when the target revision no longer exists.** A restore is an explicit user action with a named target; an error naming the missing revision is better than a silent no-op.

## Consequences

A capability directory keeps every revision's markdown, so its footprint grows with the number of revisions rather than with the size of the current procedure. Nothing prunes them: a capability edited a hundred times keeps a hundred `versions/<n>.md` files.

The Settings surface for capabilities is being redesigned by another agent, so the restore action itself is not wired into the UI by this change; the two Remote methods are the seam it needs.

## Verification

`packages/capability/capability/tests/versions.spec.ts` covers six cases against a real temporary root: two writes read back oldest first with the description each revision carried; an unknown capability answers with nothing for both reads; an unwritten revision number answers with nothing; a rollback restores the body and description as revision 3 with provenance `{ action: 'rollback', restored: 1 }`, leaves the replaced revision kept, and makes the restored body current; a rollback of an unknown revision number is refused by name; and a rollback of an unknown capability is refused. `npx tsc -b packages/capability/capability` and `npx tsc -b packages/memory/api-memory-manager` both report no errors, and the host build regenerates the Remote face with the two new methods.
