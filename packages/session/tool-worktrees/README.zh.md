---
description: "面向 git 工作树会话能力的模型侧 create_worktree 与 remove_worktree 工具：创建分支支持的检出并把会话移入其中，或移除已完成的检出。"
kind: "package-reference"
---

# @aeven/tool-worktrees

[English](README.md) | 中文

`@aeven/worktrees` 之上的 `create_worktree` 与 `remove_worktree` 模型工具。

## 概述

`@aeven/tool-worktrees` 让 agent 把任务放进自己的 git 检出，并在之后清理。`create_worktree` 从 `HEAD` 或模型指定的修订创建分支支持的检出并把会话移入其中，于是并行 agent 不再共用同一个工作树和同一条分支；`remove_worktree` 在分支合并或放弃后移除检出。子智能体无需调用即获得自己的检出。凡是 agent 与其他 agent 并行处理同一仓库、在隔离环境中尝试改动，或让一次构建留在原地而开始下一件事，都适用。

## 目录

- [契约](#contract)
- [模型体验](#model-experience)
- [已知局限与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="contract"></a>
## 契约

- `create_worktree({})` 从会话仓库的 `HEAD` 创建一个名为 `work-<8 位十六进制>` 的检出，把会话移入其中，并报告 `{ path, branch, baseCommit, repositoryRoot }`，运行过依赖准备命令时还报告 `setup`。
- `create_worktree({ name })` 用该名称同时作为检出目录名与分支后缀；`create_worktree({ from })` 让分支从某个分支、标签或提交开始，而非 `HEAD`。
- `remove_worktree({})` 移除会话所在的检出，并把会话移回仓库的主检出；`remove_worktree({ name })` 移除指定的检出，例如子智能体的检出。`delete_branch: true` 同时删除分支。它报告 `{ path, branchDeleted }`，已知时还报告 `branch` 与 `cwd`。
- 两个工具都需要拥有它的 agent 会话；没有会话的调用者会被拒绝，因为检出是为该会话创建的，目录变更也记录在该会话上。

渲染用一句话点明后果——`This session now works there; later calls resolve relative paths against it`——这样模型不必自行推断一次检出对下一次调用意味着什么。

<a id="dev-note"></a>
## 开发备注

这些工具刻意保持轻薄。名称校验、git 调用、准备命令与目录变更全部在 `@aeven/worktrees` 中，因此工具的 spec 在临时仓库上挂载真实服务，断言 git 登记了什么、会话日志记录了什么；若工具自己运行 `git worktree add`，就会重复该服务，并与其他工具解析的目录产生偏差。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型看到生成的 [`create_worktree` 与 `remove_worktree` schema](../../../docs/tool-catalog.zh.md#aeventool-worktrees)。`create_worktree` 接受两个可选字符串 `name` 与 `from`；其描述说明检出从 `HEAD` 或命名的修订创建且不带未提交的改动，此后调用都针对它解析、写入被限制在其中，并且子智能体已自动获得自己的工作树。`remove_worktree` 接受可选的 `name` 与可选的布尔值 `delete_branch`；其描述说明默认目标、返回主检出以及 git 的拒绝情形。

#### Token 影响

在工具可见的每个请求上都有固定的 schema 成本；描述与 schema 在给定配置下保持稳定。

#### KV 缓存影响

只要定义与可见性不变，前缀即保持稳定。插件生命周期或作用域限制可能使这些 schema 的复用失效。

### 工具调用与结果

#### 模型看到什么

`create_worktree` 渲染一行，点明路径、分支、基础提交的前十二个字符以及对后续调用的后果，准备命令运行过时再加上 `Dependency setup: <outcome>`。`remove_worktree` 渲染 `Removed worktree <path>`，并说明分支是被删除还是保留，以及会话现在在哪里工作。稳定失败为 `Error: <tool> requires an owning agent session`，以及服务中指明不可用工作树名称、不可移除的工作树，或附带 git 输出的失败 git 命令的消息。

#### Token 影响

小且形状固定：几个短标识符与一两句话。准备失败时最多再加 1500 个字符的命令输出。

#### KV 缓存影响

只追加；结果跟在可复用的请求前缀之后，不使既有 KV 缓存条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与后续工作

- 模型无法通过工具列出检出；运行时上下文会点明会话自己的检出及其子级的检出，其余由 shell 列出。
- 模型无法选择检出目录或分支前缀；二者都是 `@aeven/worktrees` 上的部署配置。
- 不发布 invariant 伴随入口，因为它唯一可检查的关系是该服务自身的 git 与日志效果，单元 spec 直接观察这些效果，不存在会分歧的独立观察。
