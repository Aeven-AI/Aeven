---
description: "vcs 包组导航图：把源码管理作为单一能力 seam，包括 `ctx.vcs` 定义、git 提供方与面向模型的 git 工具，面向组合仓库工作的用户与维护者。"
kind: "package-group"
---

# vcs/ — 版本控制

[English](README.md) | 中文

## 概述

vcs 包组让 agent（智能体）对正在编辑的仓库形成可用的认识：当前检出的是哪个分支、哪些改动已暂存、哪些没有、一次变更包含什么、最近有哪些提交进入分支，以及如何在不猜测的情况下记录下一次提交。该能力分布在三个产品包中：`avn-vcs` 能力 seam（`ctx.vcs`）选择提供方并归一化每一份报告，`avn-vcs-git` 提供方通过 `ctx.subprocess` 用 git 执行这些操作，面向模型的 `avn-tool-vcs` 工具则拥有 `git_*` schema 与展示。该包组不提供代码托管平台集成：Pull Request、评审与合并队列都不在其范围内。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`vcs/`](vcs/README.zh.md) | 定义该能力：提供方注册表、仓库解析，以及归一化后的状态、差异、日志、暂存、提交、分支、远端与合并操作 | `ctx.vcs` |
| [`vcs-git/`](vcs-git/README.zh.md) | 通过 `ctx.subprocess` 用 git 执行这些操作，输出有界，失败结构化 | 注册到 `ctx.vcs` |
| [`tool-vcs/`](tool-vcs/README.zh.md) | 向模型暴露 `git_status`、`git_diff`、`git_log`、`git_commit`、`git_branch`、`git_remote` 与 `git_merge` | 注册到 `ctx.tools` |

提供方注册的是操作，而不是工具：`tool-vcs` 拥有每一个模型可见的名称、schema 与渲染，因此第二个引擎可以在不改变模型所见的前提下应答同样的调用。

-----

<a id="related-documentation"></a>
## 相关文档

- [版本控制子系统](../../docs/subsystems/vcs.zh.md)——操作、按侧变更报告、界与 `VcsError` 错误码。
- [源码管理作为能力的 Agent Note](../../.agents/notes/implemented/architecture/2026-10-30-source-control-as-a-capability.zh.md)——为什么这些操作构成一个 seam，以及哪些工作仍然延后。
- [生成的工具目录](../../docs/tool-catalog.zh.md)——模型收到的 `git_*` schema。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
