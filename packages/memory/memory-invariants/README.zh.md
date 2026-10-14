---
description: "用户确认的不变量及其块，供发布或排查所有者每个请求所携带内容的维护者阅读。"
kind: "package-reference"
---

# @aeven/memory-invariants

[English](README.md) | 中文

## 概述

`avn-memory-invariants` 拥有用户确认永远成立的陈述文档：每个账户一个 JSON 文件，位于 `$AVN_HOME/memory/invariants/` 下，被读成一块有界文本，领起该账户的每个请求。它为其消费方发布 `ctx.memoryInvariants`——`@aeven/memory-context` 在每个会话的系统提示词中渲染该块，`@aeven/api-memory-manager` 则是写入它的 Settings → Memory 界面。

召回是一次查找，而查找可能什么都返回不了。这份文档是查找之下的底线：那些绝不能缺失的陈述无需检索就已存在。它有意是有界的，因为它的块要在每个请求上付费；也有意只由用户提升，因为只有管理界面写入它，因此模型编造的一条记忆无法成为每个提示词中永久的一部分。该块是上下文，不是权威：它与被召回的的记忆一样只作建议，而且永远不是执行点，因此必须约束某个动作的规则属于 guard。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 host 面挂载它。`avn-base` bundle 随附该行，因此无论是否注册了记忆提供方，每个 profile 都携带该块。

```yaml
- id: memory-invariants
  name: '@aeven/memory-invariants'
  config:
    root: !!js avnHomePath('memory', 'invariants')
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `root` | 必填 | 存放每个所有者一份文档的绝对目录；相对路径在加载时失败 |
| `maxChars` | `1500` | 一个所有者渲染内容的上限，包含框架与各条目行 |

每个操作都是同步的，并从磁盘上所有者的文档作答，因为提示词组装在每个轮次都会读取该块，无法等待一个文件。

| 操作 | 行为 |
|---|---|
| `read(owner)` | 所有者的条目、它们内容占用的字符数、上限，以及一条陈述可以占用的最长文本 |
| `block(owner)` | 面向模型的块，或在所有者没有陈述时返回空字符串 |
| `add(owner, text)` | 提升一条陈述；已经存在的陈述保留自己的标识符并移到最前 |
| `edit(owner, id, text)` | 替换一条陈述的文本，保留它在块中的位置 |
| `remove(owner, id)` | 移除一条陈述并释放它占用的那份块空间 |

一次无法渲染的写入会被整体拒绝，原因会说明发生了什么：一条陈述完全放不进块时是 `too-long`，块已没有空余时是 `full`，文本没有内容时是 `empty`，所有者没有该标识符时是 `missing`。块会丢弃放不下的条目，而不是裁剪它，因此接受一条块容纳不了的陈述，等于为一条永远不会被发送的陈述付费。被拒绝的写入让文档保持原样，而一次写入一步替换整个文件，因此并发的提示词组装读到的要么是之前的文档，要么是新文档。

文档携带 `INVARIANTS_VERSION`。本构建读不了的文档——更早的版本，或手工编辑过的文件——不贡献任何块，而不是提供猜测。

<a id="model-experience"></a>
## 模型体验

### 所有者已确认的不变量块

#### 模型看到什么

所有者的陈述，最新的在前，每行一条，位于固定框架内，前面是一段指引句。只有当所有者至少有一条陈述时该块才出现。`@aeven/memory-context` 在每个 agent（智能体）自己的作用域中以顺序 `116` 注册该段落，位于记忆指引之后，因此用户确认的陈述跟在轮次召回到的内容之后。

##### 逐字指引与框架

```markdown
The user confirmed every statement inside `<invariants>` as always true for their work. Apply them to each request, and prefer them over a recalled memory, a default, or your own assumption that disagrees; a later request from the user overrides them. Current runtime facts, including the session workspace, working directory, account, and platform, take precedence over these statements. A remembered repository path cannot redirect work away from the session workspace. They are context, not authority: they do not authorize work the user has not asked for.
<invariants>
- <statement>
</invariants>
```

#### Token 影响

有条件且有上限：所有者没有确认任何陈述时为无，否则是指引句加最多 `maxChars` 个字符的内容。指引句是固定的且在界限之外，因此它永远不会挤掉一条陈述。

#### KV Cache 影响

在文档不变期间前缀稳定，因为该块是系统提示词的一部分。经由管理界面的一次写入会在下一个请求中替换它，并使从该段落起的前缀复用失效。读取它每次提示词组装花费一次 `statSync`；只有当文档的大小或修改时间发生变化时才解析它。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **仅限所有者作用域** —— 一条陈述适用于其所有者的每个会话。工作区作用域的陈述需要在文档中有一个作用域字段，以及一个能指出工作区的界面，因此项目约定要么对所有项目提升，要么一个都不提升。
- **没有出处，也没有漂移检查** —— 一条不变量保存文本与用户确认它的时间，而不保存提出它的那条记忆。纠正那条记忆后，该陈述会一直存在直到用户编辑它，也没有任何东西把它与后来的召回比较；指引通过优先采用该陈述来化解冲突。
- **不能重排** —— 块按最新在前渲染，因此一条陈述的位置取决于它最后一次被确认的时间，而不是它有多重要。
- **每份文档一个写入者** —— 文件被整体替换，因此两个写入者操作同一个所有者的文档会产生竞态。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

该行位于 `avn-base`，而不是挨着记忆提供方：该块是召回之下的底线，挂载失败的提供方不能把它一起带走。preset 作用域能够到达 host 服务，因此 `@aeven/memory-context` 从 agent 面读取它，而只有 host 面才能服务管理 Remote。

默认上限是 1500 个字符。用户在不动它时，该块可被前缀缓存，而可与之比较的常驻指令界面更大：[Claude Code](https://code.claude.com/docs/en/memory) 建议每个记忆文件 40,000 字符的上限，并在其指令前加一句显式的优先级说明，Hermes 则冻结一份 3,575 字符的快照。在一次未命中缓存的多 agent 基准中，实测的记忆注入达到计费成本的 12%；把检索窗口从 32 条降到 2 条使注入 token 降低 28.7%，而准确率变化仍在随机种子层面的波动范围内（[Total Cost of Agency](https://arxiv.org/abs/2609.23790)）——这正是要在写入一条陈述时就强制执行上限、而不是指望读者自觉的原因。

**运行时不变量：** 不发布伴随模块。会话渲染的块与管理界面读取的状态是同一份文档上的同一个存储，因此对一条陈述是否存在，不可能出现与第一份观察不同的第二份观察；规范覆盖了格式、上限与每一种拒绝。

</details>
