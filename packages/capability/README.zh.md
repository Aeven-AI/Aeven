---
description: "capability 分组映射：Aeven 自动学习、并作为建议上下文召回的按用户流程。"
kind: "package-group"
---

# capability/ — 已学能力

[English](README.md) | 中文

## 概述

能力分组让 agent（智能体）为一个已登录用户学习可复用的流程。一项能力是一个与 agentskills 兼容的目录（`SKILL.md` 加配套文件），Aeven 元数据放在 `capability.json` 中。Aeven 从已完成的工作中自动学习它，不询问任何人，并把它存为不进入自动召回的候选；经过有意验证的流程可以作为历史参考被召回，而后续报告的执行会提升、降级或退役它，用户则在 Settings → Memory 中评审、编辑或删除它。能力的存储与执行只由 Aeven 完成：记忆提供方可以帮忙找到它们，但运行它们从不需要它。

## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`capability/`](capability/README.zh.md) | 按用户的流程存储、修订与执行证据 | `ctx.capabilities` |
| [`tool-capability/`](tool-capability/README.zh.md) | 自动学习器、已学流程的召回、执行证据与 `capability_manage` 工具 | 注册到 `ctx.tools` |

## 相关文档

- [能力学习 Agent Note](../../.agents/notes/implemented/feature/2026-09-29-capability-learning.zh.md) —— 各项状态，以及为什么执行从不依赖记忆；[生命周期说明](../../.agents/notes/implemented/feature/2026-09-29-capability-lifecycle.zh.md) —— 证据、自动学习与 Settings → Memory。
- [长期记忆路线图](../../.agents/notes/proposed/feature/2026-09-28-long-term-memory-roadmap.zh.md) —— 能力学习在计划中所处的位置。

## 开发备注

无。
