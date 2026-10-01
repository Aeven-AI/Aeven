---
description: "The learned-capability registry for maintainers storing, changing, or publishing per-user capabilities."
kind: "package-reference"
---

# @aeven/capability

## Summary

`avn-capability` provides `ctx.capabilities`, the registry of capabilities each signed-in user's agents learned. Every operation takes the owner's account id. A capability is a directory `<root>/<owner>/<name>/` holding an agentskills `SKILL.md` (frontmatter `name` and `description`, then the procedure), supporting files under `references/`, `scripts/`, `templates/`, `assets/`, or `examples/`, `capability.json` with status, revision, source, timestamps, file list, and provenance, `versions/<revision>.md` with every revision's procedure, and `executions.jsonl`, the append-only evidence log. The service registers the `learned-capabilities` skill provider, which lists the viewing owner's executable capabilities (`learned`, `trusted`, `needs-validation`, `degraded`) in the skill catalog; `candidate` and `retired` capabilities never reach it.

## Use this package

Mount it on the host plane. The web bundle mounts it with `root: !!js avnHomePath('capabilities')`.

| Field | Default | Meaning |
|---|---|---|
| `root` | required | Absolute directory holding one subdirectory per owner |
| `skillRank` | `550` | Skill-catalog rank of learned capabilities; user-authored skills (100–500) win duplicate names, bundled skills (600) lose |
| `trustAfter` | `3` | Successful executions of the current revision needed to become trusted; at least one must be verified |
| `degradeAfter` | `2` | Consecutive failed executions of the current revision that degrade a capability |

### Lifecycle

Only the user makes a capability executable (`candidate` → `learned`) or retires it. Evidence moves executable capabilities, and only executions of the current revision count:

| Status | When |
|---|---|
| `trusted` | `trustAfter` successful executions, at least one verified, and the latest known one not failed |
| `degraded` | the last `degradeAfter` known executions failed |
| `needs-validation` | the procedure changed after it was trusted and no verified execution of the new revision exists |
| `learned` | otherwise |

An execution records revision, session, turn, timing, model route, environment (platform, architecture, major OS release), tools called after the capability loaded, provider retries, token usage, turn end reason, and the model's report. Corrections and ratings arrive later as amendments. An execution fails on a correction, a negative rating, a failed report or verification, or a failed turn; it is verified by a positive rating, or by a reported passed verification together with at least one successful tool call, so a report alone never verifies; a success report alone is `succeeded`. Loading a `degraded` or `needs-validation` capability, or one that has succeeded only in other environments, prefixes its procedure with a short evidence note.

Writes to one capability run one at a time; each committed write invalidates the skill catalog and emits `capabilities/changed`. `patch` replaces a passage that must occur exactly once. Names are kebab-case, at most 64 characters, and supporting-file paths cannot leave their folder.

Every write keeps its revision's `SKILL.md` under `versions/<revision>.md`, so a revision stays attributable to the executions that followed it and an earlier procedure is recoverable. `versions(owner, name)` reads them back oldest first, with the description each revision carried, and `rollback(owner, name, revision, sessionId)` writes one as a new revision whose provenance records `action: 'rollback'` with `restored: <revision>`; the restored revision then answers to its own evidence like any other, so a restore does not inherit trust. Both reads answer with nothing rather than throwing when no body was kept.

## Model Experience

The registry adds no prompt text or tools. A learned capability appears in the skill catalog under its name and description, and loading it renders its `SKILL.md` body with its directory as the resource base.

## Known Limitations and Deferred Work

- **Evidence is recorded where the capability ran** — the execution log is local to this Host and is not synced.
- **Owner comes from the lookup** — sessions without `SessionHeader.owner` see no learned capabilities.

## Dev Note

None.
