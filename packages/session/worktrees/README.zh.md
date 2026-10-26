---
description: "Git 工作树作为会话能力：每个任务或子智能体一个分支支持的检出，位于仓库之外，写入被限制在其中。"
kind: "package-reference"
---

# @aeven/worktrees

[English](README.md) | 中文

## 概述

`@aeven/worktrees` 让一个任务拥有自己的检出，使同一仓库上的智能体不会在彼此的工作树里编辑、构建或切换分支。`create()` 添加一个分支支持的检出并把会话移入其中；`isolate()` 与 `adopt()` 让每个委派的进程内子智能体从父级工作树的快照获得自己的检出；`remove()` 删除一个检出，并可选地删除其分支。检出位于所有仓库之外，被移动会话的工作区根就是该检出，因此 `workspace-write` 把它的写入限制在那里。

## 目录

- [契约](#contract)
- [配置](#configuration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知局限与后续工作](#known-limitations-and-deferred-work)

-----

<a id="contract"></a>
## 契约

一个仓库的检出位于 `<directory>/<仓库名>-<其共享 git 目录的 8 位十六进制摘要>/<name>`，分支为 `<branchPrefix><name>`。名称由字母、数字、点、短横线和下划线组成，并以字母或数字开头。服务自身的 git 调用带 `core.hooksPath=/dev/null` 与 `core.fsmonitor=false` 运行，因此不会运行仓库配置的钩子或监视程序。

`create(session, { name?, from? }, signal?)` 把 `from`（默认 `HEAD`）解析为提交，运行 `git worktree add -b`，运行[配置](#configuration)中描述的准备条目，然后用 `workingDirectory.enter()` 移动会话并追加 `worktree/entered`。未给名称时使用生成的 `work-<8 位十六进制>`。当前检出中未提交的改动不会带过去。git 失败会附带 git 的输出抛出，会话保持原位。

`isolate(parent, childId, signal?)` 在 `isolateSubagents` 关闭，或父级目录不是带提交的 git 仓库时返回 `undefined`。否则它通过索引的副本，把父级工作树——已跟踪的改动与未跟踪、未忽略的文件——记录为 `HEAD` 之上的一个提交，因此用户的索引、文件与分支都不受影响；干净的工作树直接使用 `HEAD`。它从该提交创建 `subagent-<8 位十六进制>`，运行准备条目，向父级日志追加 `worktree/delegated`，并返回该检出。`adopt(child, worktree)` 在子级创建窗口内同步地把子级移入，并追加 `worktree/entered`。`@aeven/subagent` 对每个进程内子级（一次性的与可继续的）调用这两者。

`remove(session, name?, { deleteBranch }, signal?)` 移除指定的检出，或会话所在的检出。位于其中的会话会先移回仓库的主工作树。`git worktree remove` 拒绝带未提交改动的检出，`git branch -d` 拒绝未合并的分支；两种拒绝都作为错误抛出。成功时追加 `worktree/removed`。

`list(session, signal?)` 把 `git worktree list --porcelain` 解析为 `{ path, ref, head, main, prunable }` 条目，主工作树在前。

`worktrees` 投影把这三个事件折叠为会话所在的检出，以及它为子级创建的检出。每次请求前，它把该状态渲染为运行时上下文：位于自己检出中的会话会被告知检出、分支、基准提交与准备结果；父级会被告知每个子级的分支、路径与基准，以及如何取回工作（干净工作树上用 `git merge <branch>`，存在未提交改动时用 `git diff <base>..<branch> | git apply`）。

<a id="configuration"></a>
## 配置

| 字段 | 含义 |
|---|---|
| `directory` | 存放检出的绝对目录；加载时创建并规范化。 |
| `branchPrefix` | 每个所建分支携带的前缀。 |
| `graceMs` | git 或准备子进程在 SIGTERM 与 SIGKILL 之间获得的宽限时间。 |
| `isolateSubagents` | 每个委派的进程内子级是否在自己的检出中工作。 |
| `setup` | 有序的 `{ when, argv }` 条目；第一个其 `when` 文件存在于检出根的条目在那里不经 shell 运行 `argv`。 |
| `setupTimeoutMs` | 准备命令的截止时间。 |

基础 bundle 设置 `$AVN_HOME/worktrees`、`avn/`、`5000`、开启隔离、300000 ms 的准备截止时间，以及每种锁文件一个准备条目：`pnpm install --frozen-lockfile --prefer-offline`、`yarn install --frozen-lockfile`、`bun install --frozen-lockfile` 与 `npm ci --prefer-offline`。

<a id="dev-note"></a>
## 开发备注

该能力通过 `ctx.subprocess` 运行 git，而不是使用 git 库，因为检出是 git 自身的构造，包装库必须重现它的参数与错误语义。

检出位于仓库之外，因为 `@aeven/sandbox-policy` 把会话限制在其工作区根中：若检出位于仓库内，主工作树中的智能体就能写入每个子级的检出。链接检出的提交落在仓库的共享 git 目录中，因此沙箱策略在检出之外还授予该目录。

快照提交让子级能够审阅或继续父级尚未提交的工作。它位于 `HEAD` 与子级自己的提交之间，因此 `git diff <base>..<branch>` 恰好是子级的工作，并能在父级未提交的改动旁干净地应用。

规格测试在临时仓库中使用真实 git，因为值得测试的行为属于 git 自身：分支与检出被创建，以及重复名称经由 git 的错误路径失败。

<a id="model-experience"></a>
## 模型体验

### 工作树运行时上下文

#### 模型看到什么

位于自己检出中的会话：`You work in your own git worktree "<path>" on branch <branch>, started from commit <12 hex> of the repository at "<root>". Other agents work in other checkouts of the same repository. Commit your finished changes on this branch and name the branch when you report back.`，准备条目运行过时再加上 `Dependency setup in this worktree: <outcome>`。拥有子级检出的父级：每个检出一行，列出分支、路径、子智能体 id 与基准，然后说明如何合并或应用该工作，以及 `remove_worktree` 可移除检出。

#### Token 影响

位于检出中的会话约 60 个 token；每个子级检出约 30 个，另加约 50 个用于合并说明。

#### KV Cache 影响

运行时上下文位于稳定的系统提示之后，并随每次请求记录，因此不破坏已缓存的前缀；它仅在进入检出、为子级创建检出或移除检出时变化。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与后续工作

- **准备命令不受限制地运行。** 准备命令需要访问检出之外的包管理器存储，因此通过 `ctx.subprocess` 在沙箱之外运行。该命令属于部署配置；它运行的脚本来自仓库。
- **进程外子智能体不被隔离。** `subagent-avn-sdk`、`subagent-acp`、`subagent-claude-code` 与 `subagent-codex` 在父级的头部目录中启动子级。
- **指令与技能读取头部目录。** 项目指令与技能发现针对会话的创建目录解析，仅当分支携带相同文件时才与检出一致。
- **共享端口与缓存。** 检出隔离文件与构建，不隔离开发服务器端口或检出之外的缓存。
- **启动失败的子级保留其检出。** 检出与分支保留，父级的上下文会列出它们，以便用 `remove_worktree` 移除。
- 不发布不变量伴随模块，因为其可观察结果是 git 的退出状态与它追加的事件，规格测试直接断言了这些。
