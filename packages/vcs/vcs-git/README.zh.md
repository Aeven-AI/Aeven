---
description: "`ctx.vcs` 的 git 提供方：通过 `ctx.subprocess` 完成仓库探测，以及归一化的状态、差异、日志、暂存、提交、分支、远端与合并操作，输出有界、失败结构化，面向在 git 上运行源码管理的维护者。"
kind: "package-reference"
---

# @aeven/vcs-git

[English](README.md) | 中文

## 概述

`avn-vcs-git` 用 git 实现 `ctx.vcs`：它探测某个目录所属的检出，把 porcelain v2 状态读取为按路径划分的已暂存与未暂存变更，渲染有界的差异，列出提交与分支，并执行暂存、提交、移动分支、抓取、推送与合并。输出通过 `ctx.subprocess` 收集并当作数据解析，因此没有任何调用方依赖 git 的进度文本。只读报告在禁用仓库钩子与 fsmonitor 的情况下运行；记录历史或移动检出的命令则按仓库自身的配置运行。

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

在 `avn-vcs` 定义旁加载该插件。它注册一个 id 为 `git` 的提供方，除自身的界之外不需要其他配置。

```yaml
- id: vcs-git
  name: '@aeven/vcs-git'
  config:
    graceMs: 5000
    outputMaxBytes: 1000000
    diffMaxBytes: 200000
    logLimit: 20
    logLimitMax: 100
    statusMaxEntries: 2000
```

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `graceMs` | `5000` | git 子进程在两次终止信号之间获得的宽限期 |
| `outputMaxBytes` | `1000000` | 单条命令保留的最大 stdout 尾部；更长的流会被截断并报告为 truncated |
| `diffMaxBytes` | `200000` | 返回的最大差异；更长的差异会被截断并标记为 `truncated` |
| `logLimit` | `20` | 请求未给出时报告的提交数量 |
| `logLimitMax` | `100` | 单个请求可以要求的最大提交数量 |
| `statusMaxEntries` | `2000` | 单份状态报告保留的最大变更路径数量 |

生成的[配置目录](../../../docs/config-catalog.zh.md)是每个可接受字段的穷尽式真源。

### 值得了解的行为

已跟踪文件存在未提交变更时，`switchBranch` 以 `VCS_DIRTY_WORKTREE` 拒绝，除非请求设置了 `allowDirty`；即便设置了，git 本身仍会拒绝会覆盖这些变更的切换。带 `paths` 的 `commit` 会先暂存这些路径，而没有任何暂存内容的提交会以 `VCS_INVALID_REQUEST` 失败，而不是返回一个含义不明的退出状态。`merge` 返回 `conflicted` 与未合并的路径，而不只是 git 的退出码；`abort` 丢弃进行中的合并。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计要点

- **报告类命令关闭钩子与 fsmonitor。** 探测、状态、差异、日志与脏状态检查都会传入 `-c core.hooksPath=/dev/null -c core.fsmonitor=false`，因此仓库配置的程序无法改变报告的内容。暂存、提交、分支移动、抓取、推送与合并则原样运行，因为在那里钩子就是用户的策略。
- **porcelain v2，按侧区分。** 状态使用 `--porcelain=v2 --branch -z`；每条路径分别保留其索引与工作区字符，无法归类的字符记为 `unknown`，而不是当作干净的一侧。type-2 记录的原始路径作为独立的 NUL 分隔记录到达并被消费，而不会被误读为路径。
- **有界输出，如实截断。** 每次 spawn 都收集有界的尾部；被截断的流会设置 `stdoutTruncated`，超过 `diffMaxBytes` 的差异会被切片并标记为 `truncated`。
- **不经过 shell。** 每条命令都是 argv 数组，因此看起来像 shell 语法的提交消息、路径或修订号仍然只是一个参数。
- **空历史不是失败。** 在没有任何提交的仓库中，`log` 返回空结果；首次提交之前的 `unstage` 退回到删除索引条目，因为此时没有可恢复的 HEAD。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 提供方实现、`Config` 与注册 |
| [`src/git.ts`](src/git.ts) | 有界 spawn、只读标记与失败构造 |
| [`src/parse.ts`](src/parse.ts) | porcelain v2 状态、日志、分支与路径列表解析器 |
| — | 无 invariant 伴随模块：检出状态属于仓库，提供方自身不持有任何可被其他包观测到发生分歧的状态。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [版本控制子系统](../../../docs/subsystems/vcs.zh.md)——操作及其归一化后的值。
- [avn-vcs](../vcs/README.zh.md)——该提供方所实现的定义。
- [avn-tool-vcs](../tool-vcs/README.zh.md)——调用它的工具。
- [vcs 包组导航图](../README.zh.md)——由三个包构成的这一组。

-----

<a id="model-experience"></a>
## 模型体验

间接地经由 `avn-tool-vcs` 体现，它渲染该后端产出的变更记录。

#### KV Cache 影响

该后端返回由消费方渲染的变更记录；它不向请求追加任何内容，因此已有的前缀保持可复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **带换行的路径会被错误解析。** 状态分割会把路径内的换行当作记录边界；受支持的格式（`-z`）会原样承载这类路径，要支持它们需要一个跟踪路径边界的解析器，而不是按行分割。
- **合并冲突只被报告，不被解决。** 该提供方列出未合并的路径；编辑这些路径并继续合并是调用方的工作，`--continue` 动词尚不存在。
- **脏状态防护只覆盖已跟踪文件。** 未跟踪文件不会阻止切换，这与 git 自身的拒绝规则对一个检出而言足够接近；需要更严格规则的请求要把 `allowDirty` 设为关闭并自行检查状态。
- **`remote` 需要可用的凭据。** 抓取与推送在宿主环境中运行，自身不做任何凭据管理，因此私有远端会以 `VCS_COMMAND_FAILED` 失败并带上 git 自己的消息。
- **没有部分暂存。** `stage` 接受整条路径；暂存文件中的某个 hunk 需要该 seam 尚未定义的补丁应用动词。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

不发布 invariant 伴随模块：每个答案都通过 `ctx.subprocess` 从磁盘上的仓库导出，第二次观测只会重复同一次读取。

</details>
