---
description: "The learned-capability registry for maintainers storing, changing, or publishing per-user capabilities."
kind: "package-reference"
---

# @aeven/capability

English | [中文](README.zh.md)

## Summary

`avn-capability` provides `ctx.capabilities`, the registry of capabilities each signed-in user's agents learned. Every operation takes the owner's account id. A capability is a directory `<root>/<owner>/<name>/` holding an agentskills `SKILL.md` (frontmatter `name` and `description`, then the procedure), supporting files under `references/`, `scripts/`, `templates/`, `assets/`, or `examples/`, `capability.json` with status, revision, source, timestamps, file list, and provenance, `versions/<revision>.md` with every revision's procedure, and `executions.jsonl`, the append-only evidence log. The service contributes no skills; the capability consumer recalls eligible procedures directly as advisory context.

## Use this package

Mount it on the host plane. The web bundle mounts it with `root: !!js avnHomePath('capabilities')`.

| Field | Default | Meaning |
|---|---|---|
| `root` | required | Absolute directory holding one subdirectory per owner |
| `trustAfter` | `3` | Successful executions of the current revision needed to become trusted; at least one must be verified |
| `degradeAfter` | `2` | Consecutive failed executions of the current revision that degrade a capability |

### Lifecycle

Candidates stay out of automatic recall. A deliberate successful use promotes a candidate to `learned`; repeated candidate failures can retire it. Users can also restore or retire a procedure. Evidence moves eligible procedures, and only executions of the current revision count:

| Status | When |
|---|---|
| `trusted` | `trustAfter` successful executions, at least one verified, and the latest known one not failed |
| `degraded` | the last `degradeAfter` known executions failed |
| `needs-validation` | the procedure changed after it was trusted and no verified execution of the new revision exists |
| `learned` | otherwise |

An execution records revision, session, turn, timing, model route, environment (platform, architecture, major OS release), tools called after the capability loaded, provider retries, token usage, turn end reason, and the model's report. Corrections and ratings arrive later as amendments. An execution fails on a correction, a negative rating, a failed report or verification, or a failed turn; it is verified by a positive rating, or by a reported passed verification together with at least one successful tool call, so a report alone never verifies; a success report alone is `succeeded`. Recall includes the procedure status as historical metadata, without instructing the agent to follow it.

Writes to one capability run one at a time; each committed write emits `capabilities/changed`. `patch` replaces a passage that must occur exactly once. Names are kebab-case, at most 64 characters, and supporting-file paths cannot leave their folder.

Every write keeps its revision's `SKILL.md` under `versions/<revision>.md`, so a revision stays attributable to the executions that followed it and an earlier procedure is recoverable. `versions(owner, name)` reads them back oldest first, with the description each revision carried, and `rollback(owner, name, revision, sessionId)` writes one as a new revision whose provenance records `action: 'rollback'` with `restored: <revision>`; the restored revision then answers to its own evidence like any other, so a restore does not inherit trust. Both reads answer with nothing rather than throwing when no body was kept.

## Model Experience

None, as the registry adds no prompt text, tool, skill, or slash suggestion of its own; the capability consumer owns what recall and inspection put in front of the model.

#### KV Cache effect

None; no prompt input originates here.
## Known Limitations and Deferred Work

- **Evidence is recorded where the capability ran** — the execution log is local to this Host and is not synced.
- **Owner comes from the lookup** — sessions without `SessionHeader.owner` see no learned capabilities.
- **Invariant omission** — No invariant companion is published because the registry keeps one home for every fact: `capabilities/changed` is emitted by the single serialized write path after the files are durable, and `list`, `get`, `versions`, `judge`, and `supportedStatus` all answer from that same directory, so a listener would re-execute the store instead of comparing an independently maintained relation.

### Dev Note

None.
