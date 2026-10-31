---
description: "`ctx.vcs` 定义包：提供方注册表、仓库解析，以及每个源码管理消费方都会调用的归一化状态、差异、日志、暂存、提交、分支、远端与合并操作，面向组合仓库能力的维护者。"
kind: "package-reference"
---

# @aeven/vcs

[English](README.md) | 中文

## 概述

`avn-vcs` 把源码管理定义为一项能力：`ctx.vcs` 服务持有已注册的提供方，以及调用方使用的那些操作——解析仓库、报告状态、差异、日志、暂存、取消暂存、提交、列出与移动分支、抓取、推送与合并。每一份报告都经过归一化，因此消费方无需解析某个引擎的输出即可读取分支、变更与历史事实，而使用另一种引擎的提供方应答同样的调用。把它与 `avn-vcs-git` 之类的提供方组合使用；单独使用时该服务没有可执行的操作，并以 `VCS_UNAVAILABLE` 失败。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

消费方注入 `vcs`，并用检出目录内的任意目录调用某个操作；服务选择提供方、解析仓库根目录，并对其运行该操作。

```ts
const status = await ctx.vcs.status(sessionDirectory(ctx, session), exec.signal)
if (status.branch === null) throw new Error('detached HEAD')
```

### 操作

`repository(cwd)` 返回提供方与检出根目录。`status` 报告分支、上游、领先／落后与发生变更的路径。`diff`、`log`、`stage`、`unstage`、`commit`、`listBranches`、`switchBranch`、`deleteBranch`、`remote` 与 `merge` 承担其余工作。请求都是普通值：`VcsDiffRequest`（`path`、`staged`、`range`）、`VcsCommitRequest`（`message`、`paths`）、`VcsSwitchRequest`（`name`、`create`、`from`、`allowDirty`）、`VcsRemoteRequest`（`operation`、`remote`、`branch`）与 `VcsMergeRequest`（`ref`、`abort`）。

### 失败

每一次失败都是携带一个稳定错误码的 `VcsError`：`VCS_UNAVAILABLE`（没有注册任何提供方）、`VCS_INVALID_PROVIDER` 与 `VCS_CONFLICT`（注册）、`VCS_NOT_A_REPOSITORY`（没有提供方拥有该目录）、`VCS_INVALID_REQUEST`（提供方在执行前拒绝的请求）、`VCS_DIRTY_WORKTREE`（会移动未提交工作的分支切换）、`VCS_CONFLICT_STATE`（遗留未解决的合并）与 `VCS_COMMAND_FAILED`（引擎拒绝执行）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计要点

- **每个包一个角色。** 本包声明操作与注册表；提供方实现这些操作，工具消费方拥有面向模型的 schema。
- **原子注册。** `registerProvider` 在变更前校验 id 并做冲突检查；被拒绝的注册不发布任何内容，`ctx.effect` 会在 dispose（资源释放）时撤回提供方。
- **靠探测，不靠配置。** 选择时询问每个提供方是否拥有该目录，因此挂载在任何位置的检出都无需配置根目录即可工作。
- **仓库根目录解析。** 每个操作都先把 `cwd` 解析为检出根目录，因此子目录或被迁入的 worktree 表现与仓库根目录一致。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `Vcs` 服务、`VcsError`、注册与操作委派 |
| [`src/types.ts`](src/types.ts) | 报告、请求、提供方与服务类型 |
| [`src/brand.ts`](src/brand.ts) | 带品牌的提供方 id |
| — | 不发布 invariant 伴随模块：本包只持有注册表并做委派，它能断言的关系属于拥有检出的那些提供方。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [版本控制子系统](../../../docs/subsystems/vcs.zh.md)——操作、按侧变更报告与界。
- [avn-vcs-git](../vcs-git/README.zh.md)——该服务所选择的 git 提供方。
- [avn-tool-vcs](../tool-vcs/README.zh.md)——面向模型的工具。
- [vcs 包组导航图](../README.zh.md)——由三个包构成的这一组。

-----

<a id="model-experience"></a>
## 模型体验

无：本包不贡献任何提示词文本、工具 schema 或结果，它的值只通过消费方到达模型。

#### KV Cache 影响

该服务没有任何内容进入模型请求，因此提供方缓存复用不受影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **每个目录只有一个提供方。** 选择取第一个 `detect` 返回根目录的提供方；两个提供方都声称拥有同一目录时没有仲裁规则，若要为同一目录引入第二个引擎，必须先定下这条规则。
- **没有代码托管平台操作。** Pull Request、评审、检查与合并队列都在该 seam 之外；`remote` 只做抓取与推送。
- **没有冲突解决动词。** `merge` 报告冲突路径，但把路径标记为已解决、选定某一侧以及继续合并都不是操作；调用方在编辑完文件后通过提供方提交。
- **没有 stash 与 reset。** 该 seam 没有 `stash`、`reset`、`revert` 或 `cherry-pick`；需要其中之一的消费方要在此处添加，而不是在提供方中。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
