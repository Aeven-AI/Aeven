---
description: "The team group map: the task board shared by one subagent tree and its model-facing tools, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/team

English | [中文](README.zh.md)

## Summary

The team group gives agents that work together in one subagent tree a shared task board: tasks with owners, dependencies, safe claiming, and warnings when two tasks in progress plan to touch the same files. The board belongs to the tree's root agent and is always available; there is no mode to switch on. Creating, finding, messaging, and interrupting agents stay in the subagent group, so the board only tracks who does what.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`agent-team`](agent-team/README.md) | Shared task board stored in the subagent tree's root Session | `ctx.agentTeams` |
| [`tool-agent-team`](tool-agent-team/README.md) | The four `team_task_*` tools that read and change the board | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Agent Teams subsystem](../../docs/subsystems/agent-team.md) — the `team/task` event, task types, and the `ctx.agentTeams` service API.
- [Subagent packages](../subagent/README.md) — delegation, tree discovery, and messaging between agents.
- [Generated tool catalog](../../docs/tool-catalog.md#aeventool-agent-team) — the task tool schemas the model receives.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
