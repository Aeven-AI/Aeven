---
description: "Git 工作树作为会话容量：通过 git 创建分支支持的检出，把会话移入其中，并列出仓库拥有的检出。"
kind: "package-reference"
---

# @aeven/worktrees

[English](README.md) | 中文

## 概述

`@aeven/worktrees` 让一个任务拥有自己的检出。`create()` 运行 `git worktree add -b <prefix><name> <path> <rev>`，然后通过 `@aeven/working-directory` 把会话移入新目录，此后每次文件、shell 与搜索调用都针对该检出解析，而不是共享的工作树。`list()` 读取仓库已登记的检出。适用于并行智能体会争用同一分支和同一构建目录，或者某个改动不该触碰主工作树里尚未提交的内容。

## 目录

- [契约](#contract)
- [配置](#configuration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知局限与后续工作](#known-limitations-and-deferred-work)

-----

<a id="contract"></a>
## 契约

`create(session, { name?, from? }, signal?)`：

1. 从会话的生效目录解析仓库根（`git rev-parse --show-toplevel`）。
2. 校验名称——字母、数字、点、短横线、下划线，且以字母或数字开头——因为该名称既是分支叶子也是目录叶子。未给出名称时使用生成的 `work-<8 hex>`。
3. 解析基线提交（`rev-parse <from>`，默认 `HEAD`），然后运行 `git worktree add -b <branchPrefix><name> <root>/<directory>/<name> <from>`。
4. 用 `workingDirectory.change()` 移动会话，即追加 `session/cwd`。
5. 返回 `{ path, branch, baseCommit, repositoryRoot }`。

重名、git 拒绝的名称，或 git 无法创建的目录，都以 git 失败的形式出现，带上其 stderr 并指明命令与退出码；会话目录保持不变，因为目录变更只在 `git worktree add` 成功之后才发生。

`list(session, signal?)` 把 `git worktree list --porcelain` 解析为 `{ path, ref, head, main, prunable }` 条目，主工作树在最前。

<a id="configuration"></a>
## 配置

| 字段 | 含义 |
|---|---|
| `directory` | 仓库根之下存放检出的目录。 |
| `branchPrefix` | 每个创建的分支所带的前缀。 |
| `graceMs` | git 子进程在 SIGTERM 与 SIGKILL 之间获得的宽限。 |

基础 bundle 设为 `.aeven/worktrees`、`avn/` 与 `5000`。

<a id="dev-note"></a>
## 开发备注

该容量通过 `ctx.subprocess` 运行 git，而不是引入 git 库，因为检出本身就是 git 的构造：`worktree add`、`worktree list` 与 `worktree remove` 就是这些操作，库的包装只会重新实现它们的参数与错误语义而无所收益。

`create` 中的顺序很重要：先解析基线提交，再创建检出，最后移动目录。任何一步失败都让会话留在原处，这正是“检出失败，就在原处继续”能成为模型安全答案的原因。

规格在临时仓库里使用真实 git，因为值得测试的恰恰是模拟无法展示的部分：分支与目录被创建、源工作树中未提交的文件留在原处而不进入新检出、重名通过 git 自身的错误路径失败。

<a id="model-experience"></a>
## 模型体验

### `create_worktree` 工具 schema

#### 模型看到什么

模型看到生成的 [`create_worktree` schema](../../../docs/tool-catalog.zh.md#aeventool-worktrees)：一个带有可选 `name` 与 `from` 字符串的对象。描述说明工作树让任务拥有自己的检出——在同一仓库上并行工作、尝试改动而不触碰主工作树——并且之后的调用针对新目录解析。

#### Token 影响

在工具可见的每个请求上固定付出 schema 成本。

#### KV Cache 影响

在定义与可见性不变时前缀稳定。插件生命周期或作用域限制可能使该 schema 起点的复用失效。

### 工具调用与结果

#### 模型看到什么

成功返回 `{ path, branch, baseCommit, repositoryRoot }`，并渲染一行：`Created worktree <path> on branch <branch> (from <short sha>). This session now works there; later calls resolve relative paths against it.` 失败内容是 git 命令、其退出码与 stderr，或 `create_worktree requires an owning agent session`。

#### Token 影响

每次调用一个结果：两个路径、一个分支与一个提交前缀。检出本身不消耗 token；模型从该结果以及后续调用解析出的路径得知新目录。

#### KV Cache 影响

只追加；结果跟在可复用的请求前缀之后，不使既有 KV-cache 条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与后续工作

- **`list` 没有工具。** 容量能列出检出，但尚无面向模型的动词暴露它；需要知道同级检出的模型得问 shell。
- **移除仍需手工。** 没有包装 `git worktree remove`，因此完成的检出会一直登记，直到有人移除或目录被 prune。
- 本包不发布 `./invariant` 配套：它的可观察结果就是 git 退出状态加上它追加的 `session/cwd`，规格直接断言这些，配套只会重复它们。
- **仓库内部的检出会显示为未跟踪。** 配置的 `directory` 默认位于仓库根之下，因此未忽略它的仓库会在 `git status` 中报告 `.aeven/`。想要干净源树的部署把 `directory` 指向仓库之外。
