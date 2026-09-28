---
description: "The capability group map: per-user procedures the agent learns, confirmed by the user and published through the skill catalog."
kind: "package-group"
---

# capability/ — learned capabilities

## Summary

The capability group lets an agent learn reusable procedures for one signed-in user. A capability is an agentskills-compatible directory (`SKILL.md` plus supporting files) with Aeven metadata in `capability.json`. It is kept the moment the agent writes it, as an unconfirmed draft, and becomes executable only after the user confirms it; confirmed capabilities reach later sessions through the existing skill catalog. Capabilities are stored and executed by Aeven alone: the memory provider may help find them but is never needed to run them.

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`capability/`](capability/README.md) | Per-user capability registry on local files, and the skill provider that publishes learned capabilities | `ctx.capabilities` |
| [`tool-capability/`](tool-capability/README.md) | `capability_manage` tool, guidance on when to learn, user confirmation, and recall of unconfirmed drafts | registers on `ctx.tools` |

## Related documentation

- [Capability learning Agent Note](../../.agents/notes/implemented/feature/2026-09-29-capability-learning.md) — statuses, confirmation, and why execution never depends on memory.
- [Long-term memory roadmap](../../.agents/notes/proposed/feature/2026-09-28-long-term-memory-roadmap.md) — where capability learning sits in the plan.

## Dev Note

None.
