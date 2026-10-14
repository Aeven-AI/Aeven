---
description: "The capability group map: per-user procedures Aeven learns automatically and recalls as advisory context."
kind: "package-group"
---

# capability/ — learned capabilities

English | [中文](README.zh.md)

## Summary

The capability group lets an agent learn reusable procedures for one signed-in user. A capability is an agentskills-compatible directory (`SKILL.md` plus supporting files) with Aeven metadata in `capability.json`. Aeven learns it automatically from completed work, without asking anyone, and stores it as a candidate excluded from automatic recall; deliberately validated procedures can be recalled as historical reference, and reported executions then promote, degrade, or retire them, and the user reviews, edits, or deletes it in Settings → Memory. Capabilities are stored and executed by Aeven alone: the memory provider may help find them but is never needed to run them.

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`capability/`](capability/README.md) | Per-user procedure storage, revisions, and execution evidence | `ctx.capabilities` |
| [`tool-capability/`](tool-capability/README.md) | Automatic learner, recall of learned procedures, execution evidence, and the `capability_manage` tool | registers on `ctx.tools` |

## Related documentation

- [Capability learning Agent Note](../../.agents/notes/implemented/feature/2026-09-29-capability-learning.md) — statuses and why execution never depends on memory; [lifecycle note](../../.agents/notes/implemented/feature/2026-09-29-capability-lifecycle.md) — evidence, automatic learning, and Settings → Memory.
- [Long-term memory roadmap](../../.agents/notes/proposed/feature/2026-09-28-long-term-memory-roadmap.md) — where capability learning sits in the plan.

## Dev Note

None.
