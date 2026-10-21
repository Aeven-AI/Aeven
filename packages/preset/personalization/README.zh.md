---
description: "按账户个人化：每个已登录用户希望 Aeven 如何与自己交谈，供配置或排查它的用户与维护者阅读。"
kind: "package-reference"
---

# @aeven/personalization

[English](README.md) | 中文

## 概述

`@aeven/personalization` 按已登录账户存储该人希望 Aeven 如何与自己交谈：一种语气（`automatic`、`warm`、`direct` 或 `playful`）、用他们自己的话写下的备注，以及——如果本人写过——属于他们自己的主提示词。它把这些偏好渲染进该人所拥有的每个会话的系统提示词，紧跟在 persona（人设）之后，并把本人的主提示词放在该人自己发起的会话里、取代部署的 persona 段落。它在 Settings → Personalization 背后提供 `personalization` Remote。Aeven 称呼他们的名字不存放在这里：它是注册命名步骤所询问的账户显示名，随每条消息以 `<user_profile>` 到达模型；而 Aeven 在对话中如何称呼他们，读自对话本身。保留全部默认值的人除部署的 persona 外不给提示词贡献任何内容。

## 目录

- [配置](#configuration)
- [行为](#behavior)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

```yaml
- id: personalization
  name: '@aeven/personalization'
  config:
    root: !!js avnHomePath('personalization')
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `root` | 必填 | 存放每个账户一份文档的绝对目录 |
| `maxNotesChars` | `1500` | 一个人可以存储的备注文本上限 |
| `maxMasterPromptChars` | `20000` | 一个人可以存储的主提示词上限 |
| `promptOrder` | `10` | 偏好段落的提示词顺序；persona 位于 `0` |

<a id="behavior"></a>
## 行为

- **存储。** 在配置的 `root` 下每个账户一份 JSON 文档，以转义后的账户 id 命名。一次写入以一次重命名替换文档，因此并发的提示词组装读到的要么是之前的文档，要么是新文档，绝不会读到残缺的。本版本读不了的文档给出默认值。
- **提示词段落。** `user:personalization` 注册在每个 agent 的作用域中，并在每次组装时读取会话所有者的文档，只有当文件大小或修改时间变化时才重新读取。没有所有者的会话不渲染任何内容。
- **语气。** `automatic` 不添加任何内容，让 persona 自己对当下的解读说了算；其他语气跨主题保持一致。指引句告诉模型这些偏好优先于 persona 的语气默认值，而对话中的请求优先于它们。
- **主提示词。** 本人的主提示词存放在同一份文档中，并注册为其所拥有的每个顶层 agent 作用域中的 `deployment:persona` 段落，因此只在这些人自己的会话里遮蔽预设的 persona。值为空时由部署的 persona 掌管；段落会回落到从部署组合中读到的出厂文本，因此被改成空的文档绝不会让某个会话失去身份。被委派的子代理沿用出厂 persona：子 agent 可能在同一作用域注册自己的 persona，而同一作用域内同名两次注册会失败。
- **界限。** 备注与主提示词都会被修剪，超出上限的文本会带原因 `notes-too-long` 或 `master-prompt-too-long` 被整体拒绝，而不是被裁剪。
- **Remote。** `get()` 返回调用方的偏好、其会话读到的主提示词（`effectiveMasterPrompt`：本人写过就是本人的，否则是出厂文本）、它是否出自本人（`customMasterPrompt`）以及界限；`update(change)` 应用其中出现的字段；`resetMasterPrompt()` 让出厂提示词重新掌管。三者都为当前已登录用户行事，没有已登录用户时抛出。`changed: false` 的变更报告文档原本就已持有的内容。

<a id="model-experience"></a>
## 模型体验

### `user:personalization` 系统提示词段落

#### 模型看到什么

一个系统提示词段落，在每个 agent 自己的作用域中以配置的 `promptOrder`（默认 `10`）注册，因此它读起来像是对紧邻其上的 persona 的修订。它的文本在每次组装时从会话所有者的文档求值，没有所有者的会话不渲染任何内容。主提示词沿用预设自身的段落名与顺序，因此什么都没写的人渲染出的组装提示词，与把出厂文本原样写回的人完全一致；只有最后几段不同，因为本人的文本是整体取代部署文本。由于该段落是系统提示词的一部分，每个 `request/header` 事件都会记录它，因此一次变更从它到达的第一个请求起就能从日志重建。

##### 逐字指引与框架

```markdown
How this person asked you to talk with them. It outranks the voice defaults above; something they ask for in the conversation outranks it.
<personalization>
Voice: <the instruction of the chosen voice>
In their own words: <the person's notes>
</personalization>
```

##### 作为 `deployment:persona` 的主提示词

```markdown
<the person's own text, or the shipped persona the deploying composition registered>
```

##### 逐字语气指令（`warm`、`direct`、`playful`，按此顺序）

```markdown
Voice: Really warm and friendly in every reply, technical work included: encouraging, kind and conversational, like a friend who is glad to help, while staying exact.
Voice: Straight to the point in every reply, personal topics included: brief and plain, no small talk, and still kind.
Voice: Light and playful: humour and casual language are welcome, while the substance stays accurate.
```

#### Token 影响

有条件：保留 `automatic` 且备注为空的人为无；否则是固定的指引句、承载所选语气自身指令的 `Voice:` 行（即上面三条之一），以及在他们写了内容时的 `In their own words:` 行。备注受 `maxNotesChars`（默认 `1500`）约束，更长的文本会被拒绝而不是被裁剪，因此该段落永远不会超出读者设定的范围。

#### KV Cache 影响

在该人不动这份文档期间前缀稳定：该段落位于系统提示词靠前位置，每个后续请求都原样复用它。一次经由 Settings 的编辑会在所有者的下一个请求中从该段落起替换它；该段落之前的前缀仍可复用。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 对话中提出的风格要求（“talk to me more casually”）落到长期记忆里，而不是这份文档中；Settings 目前不显示它们。
- 被委派的子代理读到的是出厂 persona，而不是委派者的主提示词。
- **不变量省略** —— 不发布运行时不变量伴随模块，因为存储、提示词段落与 Remote 都读取同一份按账户文档，而该段落由存储自己的读取渲染，检查只能重新读取这个包已经读过的文件；`identityUsers` 拥有会话属于哪个账户。

<a id="dev-note"></a>
### 开发备注

无。
