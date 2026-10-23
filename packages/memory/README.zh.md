---
description: "memory 分组映射：跨会话的长期记忆召回、捕获与检视，供启用或扩展它的用户与维护者阅读。"
kind: "package-group"
---

# memory/ — 长期记忆能力家族

[English](README.md) | 中文

## 概述

记忆分组给 agent（智能体）超越单个会话的记忆。每个直接用户轮次都会收到一次有界的召回，把相关的早先工作作为一条持久、带来源标签的消息呈现；每个已完成的轮次都交给提供方去学习；用户确认永远成立的陈述作为一块有界文本领起其所有者的每个请求；而模型可以用工具搜索与检视记忆。Aeven 拥有 `ctx.memory` 接口、不变量文档与模型可见文本，MemOS 提供方在它们背后于 Host 进程中运行 MemOS 本地核心。该家族在每个组合中都开启，包括全新安装。

## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`memory/`](memory/README.zh.md) | Service Definition：召回、捕获与检视的单一提供方槽位，以及共用的记忆工具名 | `ctx.memory` |
| [`memory-memos/`](memory-memos/README.zh.md) | MemOS 提供方：本地 SQLite 记忆、本地嵌入、经 `ctx.llm` 的辅助 LLM 调用、可选 Viewer | 注册到 `ctx.memory` |
| [`memory-context/`](memory-context/README.zh.md) | 每轮次召回为持久上下文，以及从会话日志捕获轮次 | — |
| [`memory-invariants/`](memory-invariants/README.zh.md) | 用户确认的不变量：领起其所有者每个请求的那块有界文本 | `ctx.memoryInvariants` |
| [`tool-memory/`](tool-memory/README.zh.md) | 面向模型的 `memory_*` 搜索与检视工具 | 注册到 `ctx.tools` |
| [`api-memory-manager/`](api-memory-manager/README.zh.md) | Settings → Memory 背后的 `memoryManager` Remote：已登录用户的记忆与已学能力 | `ctx.memoryManagerController` |

## 启用

`avn-web-app` bundle 挂载 `memory` 槽位与一行默认关闭的 `memory-memos`；`standard`、`cordis` 与 `ptc` agent preset 挂载 `memory-context` 与 `tool-memory`；`avn-base` bundle 挂载 `memory-invariants`，因此无论是否注册了提供方，用户所确认的那块陈述在每个 profile 中都存在。preset 只有在每一行注入的服务都存在时才挂载，因此槽位始终存在；消费方只在提供方已注册时才添加提示词文本与工具。在 profile patch 中启用提供方：

```yaml
- id: memory-memos
  disabled: false
```

## 相关文档

- [记忆子系统](../../docs/subsystems/memory.zh.md) —— `ctx.memory` 的提供方槽位、它的召回、捕获与检视请求，以及 Settings → Memory 背后的 `ctx.memoryManagerController` Remote。
- [长期记忆 Agent Note](../../.agents/notes/implemented/feature/2026-09-28-long-term-memory-memos.zh.md) —— 为什么 Aeven 拥有这个 seam，以及 MemOS DeepSeek Harness 适配器是如何移植过来的。

## 开发备注

无。
