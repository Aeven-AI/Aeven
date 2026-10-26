---
description: "面向 git 工作树会话能力的模型侧 create_worktree 工具：从指定修订创建分支支持的检出并把会话移入其中，含模型可见的描述与结果文本。"
kind: "package-reference"
---

# @aeven/tool-worktrees

[English](README.md) | 中文

`@aeven/worktrees` 之上的 `create_worktree` 模型工具。

## 概述

`avn-tool-worktrees` 让 agent 把任务放进自己的 git 检出。一次调用从 `HEAD` 或模型指定的修订创建分支支持的工作树，并把会话移入其中，于是并行 agent 不再共用同一个工作树和同一条分支。需要一处地方来构建、重试或分叉的工作，不必再手工复制目录。凡是 agent 与其他 agent 并行处理同一仓库、在隔离环境中尝试改动，或让一次构建留在原地而开始下一件事，都适用。

## 目录

- [契约](#contract)
- [模型体验](#model-experience)
- [已知局限与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="contract"></a>
## 契约

- `create_worktree({})` 从会话仓库的 `HEAD` 创建一个名为 `work-<8 位十六进制>` 的检出，把会话移入其中，并报告 `{ path, branch, baseCommit, repositoryRoot }`。
- `create_worktree({ name })` 用该名称同时作为检出目录名与分支后缀；`create_worktree({ from })` 让分支从某个分支、标签或提交开始，而非 `HEAD`。
- 该工具需要拥有它的 agent 会话；没有会话的调用者会被拒绝，因为检出是为该会话创建的，目录变更也记录在该会话上。

渲染用一句话点明后果——`This session now works there; later calls resolve relative paths against it`——这样模型不必自行推断一次检出对下一次调用意味着什么。

<a id="dev-note"></a>
## 开发备注

该工具刻意保持轻薄。名称校验、git 调用与目录变更全部在 `@aeven/worktrees` 中，因此工具的 spec 在临时仓库上挂载真实服务，断言 git 登记了什么、会话日志记录了什么；若工具自己运行 `git worktree add`，就会重复该服务，并与 shell 工具解析的目录产生偏差。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型看到生成的 [`create_worktree` schema](../../../docs/tool-catalog.zh.md#aeventool-worktrees)：一个含两个可选字符串 `name` 与 `from` 的对象。描述说明检出从 `HEAD` 或命名的修订创建，且此后每次文件、shell 与搜索调用都针对它解析，因此模型不必在每次调用中重新解析路径。

#### Token 影响

在工具可见的每个请求上都有固定的 schema 成本；描述与 schema 在给定配置下保持稳定。

#### KV 缓存影响

只要定义与可见性不变，前缀即保持稳定。插件生命周期或作用域限制可能使此 schema 的复用失效。

### 工具调用与结果

#### 模型看到什么

成功的调用返回绝对路径、分支、基础提交与仓库根，并渲染一行，点明分支、基础提交的前十二个字符以及对后续调用的后果。稳定失败为 `Error: create_worktree requires an owning agent session`，以及服务中指明不可用工作树名称或失败 git 命令的消息。

#### Token 影响

小且形状固定：三个短标识符、一个不含布尔值的对象、一句话。检出本身不会重复发送；后续解析相对路径的调用已带有该目录。

#### KV 缓存影响

只追加；结果跟在可复用的请求前缀之后，不使既有 KV 缓存条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与后续工作

- 该工具只创建检出；模型无法列出或删除检出，因此任务结束后其检出留给运维处理。
- 模型无法选择检出目录或分支前缀；二者都是 `@aeven/worktrees` 上的部署配置。
- 不发布 invariant 伴随入口，因为它唯一可检查的关系是该服务自身的 git 与日志效果，单元 spec 直接观察这些效果，不存在会分歧的独立观察。
