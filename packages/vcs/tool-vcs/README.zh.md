---
description: "`ctx.vcs` 的面向模型源码管理工具：`git_status`、`git_diff`、`git_log`、`git_commit`、`git_branch`、`git_remote` 与 `git_merge`，按路径报告已暂存与未暂存变更，提供有界差异与结构化合并冲突，面向组合模型仓库工作的维护者。"
kind: "package-reference"
---

# @aeven/tool-vcs

[English](README.md) | 中文

## 概述

`avn-tool-vcs` 在 `ctx.vcs` seam 之上为模型提供七个源码管理工具：读取检出的分支与变更路径、读取差异或最近历史、提交、列出与移动分支、抓取或推送，以及合并。每个工具都会解析发起调用的会话目录，因此一次调用找到的是该会话实际编辑的仓库（包括会话被迁入的 worktree），并报告归一化后的值而不是 git 的进度文本。工具拥有每一个模型可见的名称、schema 与渲染；提供方只负责执行。

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

在 `avn-vcs` 与 `avn-vcs-git` 之类的提供方旁加载该插件；它不接受任何配置。

### 工具

| 工具 | 输入 | 返回 |
|---|---|---|
| `git_status` | — | 仓库、分支或分离 HEAD、带领先／落后计数的上游，以及每条变更路径及其已暂存与未暂存变更 |
| `git_diff` | `path`、`staged`、`range` | 默认是工作区相对索引的统一差异，带 `staged` 时是索引相对 HEAD 的差异，带 `range` 时是两个修订之间的差异，另加截断标志 |
| `git_log` | `limit` | 最近的提交，含哈希、作者、日期与主题 |
| `git_commit` | `message`、`paths` | 创建出的提交；`paths` 会先被暂存，省略它们则按索引当前内容提交 |
| `git_branch` | `operation`、`name`、`from`、`allow_dirty`、`force` | 带当前分支标记的分支列表、当前检出的分支，或被删除的分支 |
| `git_remote` | `operation`、`remote`、`branch` | 命令自身的输出 |
| `git_merge` | `ref`、`abort` | 结果（`merged`、`conflicted`、`up-to-date`、`aborted`）、冲突路径与 git 的输出 |

### 模型收到的内容

`git_status` 为每条变更路径渲染一行，并标明每一侧——`modified staged`、`modified unstaged`，或两者皆有——当存在的路径多于所列时它也会说明。`git_diff` 渲染差异，或渲染 `no differences`；被截断的差异带有明确的截断标记。`git_merge` 先给出结果，再在其下列出冲突路径。

### 失败与恢复

当会话没有目录、没有提供方拥有该目录（`VCS_NOT_A_REPOSITORY`）、切换会移动未提交的变更（`VCS_DIRTY_WORKTREE`），以及 git 拒绝执行（`VCS_COMMAND_FAILED`）时，工具调用会失败。每次失败都表现为模型可读且可据此行动的错误工具结果：先提交再切换、用 `path` 缩小差异范围，或解决所列冲突后再提交。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计要点

- **目录取自会话。** 每个工具都解析 `sessionDirectory(ctx, session)`，没有会话目录时直接报错失败，因此工具跟随被迁入 worktree 的会话，而不是注册时捕获的路径。
- **seam 值进，seam 值出。** 工具把 seam 的 camelCase 值映射到 schema 字段并映射回来；`VcsDiff.text` 变为 `diff`，`VcsMergeResult.conflicts` 被复制，因此 schema 从不暴露只读数组。
- **原始类型的工具 schema。** 模型只发送与任务相关的输入；远端名称、修订号与路径都是参数而非配置，每个界都放在提供方上。
- **渲染器只陈述事实，不带语气。** 状态说 `working tree clean`，差异说 `no differences`，合并在列出路径之前先给出结果。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：七个工具定义、渲染器与执行 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [版本控制子系统](../../../docs/subsystems/vcs.zh.md)——操作与归一化后的值。
- [avn-vcs](../vcs/README.zh.md)——这些工具所调用的定义。
- [avn-vcs-git](../vcs-git/README.zh.md)——应答这些调用的提供方。
- [vcs 包组导航图](../README.zh.md)——由三个包构成的这一组。

-----

<a id="model-experience"></a>
## 模型体验

间接地经由工具装配体现：它拥有这些调用的 schema 与结果投影。

#### KV Cache 影响

该工具对收到的变更记录只做渲染，不向提示词前缀追加任何内容，因此复用不受影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **不改写历史。** amend、rebase、reset、revert、cherry-pick 与 stash 都不是工具；需要它们的模型改用 shell，这也意味着这些工具无法引导或约束那部分工作。
- **每个操作族一个工具。** `git_branch` 用一个工具承载四个操作以压低 schema 数量，代价是更长的描述，以及模型必须正确设置的 `operation` 判别字段。
- **没有文件级冲突解决。** `git_merge` 报告冲突路径；编辑这些文件通过文件工具完成，而把某一项标记为已解决就是在编辑之后调用 `git_commit`。
- **没有 UI 卡片。** 结果以文本渲染，因此想要差异卡或提交卡的客户端需要一个本包尚未注册的展示转换器（presenter）。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

不发布 invariant 伴随模块：每个工具把模型参数映射到一次 `ctx.vcs` 调用，因此它报告的仓库事实属于读取这些事实的提供方。

</details>
