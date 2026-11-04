---
description: "team 组地图：同一 subagent 树共享的任务板及其面向模型的工具，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# packages/team

[English](README.md) | 中文

## 概述

team 组为同一 subagent 树中协作的智能体提供共享任务板：任务有负责人、依赖、安全认领，并在两个进行中的任务计划修改相同文件时给出警告。任务板属于树的根智能体，始终可用，无需开启任何模式。创建、发现、发消息与中断智能体仍由 subagent 组负责，任务板只记录谁做什么。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`agent-team`](agent-team/README.zh.md) | 存储在 subagent 树根 Session 中的共享任务板 | `ctx.agentTeams` |
| [`tool-agent-team`](tool-agent-team/README.zh.md) | 读取与修改任务板的四个 `team_task_*` 工具 | 注册到 `ctx.tools` |

-----

<a id="related-documentation"></a>
## 相关文档

- [Agent Teams 子系统](../../docs/subsystems/agent-team.zh.md)——`team/task` 事件、任务类型与 `ctx.agentTeams` 服务 API。
- [Subagent 包](../subagent/README.zh.md)——委派、树发现与智能体之间的消息。
- [生成的工具目录](../../docs/tool-catalog.zh.md#aeventool-agent-team)——模型接收的任务工具 schema。

-----

<a id="dev-note"></a>

<a id="开发备注"></a>

## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
