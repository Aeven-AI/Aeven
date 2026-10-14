---
description: "按用户已学能力的注册表，供存储、变更或发布这些能力的维护者阅读。"
kind: "package-reference"
---

# @aeven/capability

[English](README.md) | 中文

## 概述

`avn-capability` 提供 `ctx.capabilities`，即每个已登录用户的 agent（智能体）所学能力的注册表。每个操作都接受所有者的账户 id。一项能力是一个目录 `<root>/<owner>/<name>/`，其中放着 agentskills 的 `SKILL.md`（frontmatter 的 `name` 与 `description`，随后是流程）、`references/`、`scripts/`、`templates/`、`assets/` 或 `examples/` 下的配套文件、含状态、修订、来源、时间戳、文件清单与出处的 `capability.json`、含每个修订流程的 `versions/<revision>.md`，以及仅追加的证据日志 `executions.jsonl`。本服务不贡献任何 skill（技能）；能力消费方直接把符合条件的流程作为建议上下文召回。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

在 host 面挂载它。Web bundle 以 `root: !!js avnHomePath('capabilities')` 挂载它。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `root` | 必填 | 存放每个所有者一个子目录的绝对目录 |
| `trustAfter` | `3` | 当前修订成为受信所需的成功执行次数；其中至少一次必须是已验证的 |
| `degradeAfter` | `2` | 当前修订连续失败多少次会降级一项能力 |

### 生命周期

候选不进入自动召回。一次有意为之的成功使用把候选提升为 `learned`；候选反复失败则可以使其退役。用户也可以恢复或退役一套流程。证据推动符合条件的流程改变状态，且只有当前修订的执行才计入：

| 状态 | 条件 |
|---|---|
| `trusted` | `trustAfter` 次成功执行，至少一次已验证，且已知的最新一次没有失败 |
| `degraded` | 已知的最后 `degradeAfter` 次执行都失败 |
| `needs-validation` | 流程在受信之后发生变更，且新修订没有已验证的执行 |
| `learned` | 其他情况 |

一次执行记录修订、会话、轮次、时序、模型路由、环境（平台、架构、主操作系统版本）、能力加载后调用的工具、提供方重试、token 用量、轮次结束原因以及模型的报告。纠正与评分稍后作为修正记录到达。一次执行在出现纠正、负向评分、失败的报告或验证、或失败的轮次时判为失败；它由正向评分验证，或由一次报告的通过验证加上至少一次成功的工具调用验证，因此仅有报告永远不能验证；仅有成功报告算作 `succeeded`。召回把流程状态作为历史元数据一并给出，但不指示 agent 遵循它。

对同一项能力的写入一次只执行一个；每次提交的写入都会发出 `capabilities/changed`。`patch` 替换一段必须恰好出现一次的文本。名称使用 kebab-case，最多 64 个字符，配套文件路径不得离开自己的目录。

每次写入都把该修订的 `SKILL.md` 保留在 `versions/<revision>.md` 下，因此一个修订始终可归因于跟随其后的那些执行，更早的流程也可恢复。`versions(owner, name)` 按从旧到新读回它们，并带上每个修订当时携带的描述，`rollback(owner, name, revision, sessionId)` 把其中一份写成新修订，其出处记录 `action: 'rollback'` 与 `restored: <revision>`；被恢复的修订随后像任何其他修订一样对自己的证据负责，因此恢复不会继承信任。没有保留正文时，这两个读操作都返回空，而不是抛出。

<a id="model-experience"></a>
## 模型体验

无：注册表自己不添加任何提示词文本、工具、skill 或斜杠建议；召回与检视呈现给模型的内容由能力消费方拥有。

#### KV Cache 影响

无；这里不产生任何提示词输入。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **证据记录在能力运行之处** —— 执行日志属于本机 Host，不参与同步。
- **所有者来自本次查找** —— 没有 `SessionHeader.owner` 的会话看不到任何已学能力。
- **不变量省略** —— 不发布运行时不变量伴随模块，因为注册表为每个事实保留唯一归宿：`capabilities/changed` 由文件落盘后的单一串行写入路径发出，而 `list`、`get`、`versions`、`judge` 与 `supportedStatus` 都从同一个目录作答，因此监听器只会重新执行存储，而无法比较一份独立维护的关系。

### 开发备注

无。
