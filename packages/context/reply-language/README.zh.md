---
description: "可选启用的按步骤提醒，让回复保持在用户最新消息所用的语言；供启用或调优该插件的用户与维护者阅读。"
kind: "package-reference"
---

# @aeven/reply-language

[English](README.md) | 中文

## 概述

`avn-reply-language` 在最新步骤周围的上下文是另一种语言时，让模型的回复保持在该人自己的语言。系统提示词中的一条回复语言规则，与模型在长工具循环后期、在压缩之后、或在由 agent 报告开启的轮次中写作的位置相距很远，于是模型可能漂移到它一直在读的文件、工具输出或消息所用的语言。一旦模型在该人最新消息之后产出了输出，每个进入的步骤都会追加一行持久、带来源归属的文本，用开头几个词点名那条消息。本插件是可选启用的：Aeven preset 会挂载它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在回复必须跟随该人的语言、而模型会读到其他语言内容的组合中挂载本插件，例如双语仓库，或带有其他语言 agent 报告与工具输出的工作区。

### agent 会得到什么

当该人发过一条消息、其后已有一条助手消息或工具结果、且该步骤没有带来来自该人的新消息时，步骤会收到该提醒。在该人一条消息之后的第一个步骤不添加任何内容，因为那条消息已经是最新的内容。来自其他来源的消息，例如记忆召回、agent 转达、job 通知与其他插件的上下文，永远不算该人的消息。

### 配置

最小挂载不需要任何配置。

```yaml
- name: '@aeven/reply-language'
  config:
    excerptLength: 80
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `excerptLength` | `80` | 为标识语言而引用的该人消息的码点数 |

生成的[配置目录](../../../docs/config-catalog.zh.md#aevenreply-language)是每个被接受字段及其 JSDoc 的完整来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计理念

该插件注册 `replyLanguage` 会话投影，并前置一个 `agent/pre-step` 监听器。投影从持久事件折叠出两项读取：来源类型为 `user` 的最新 `user/message` 的序号，以及其后是否有 `assistant/message` 或 `tool/result`。监听器先委派，然后在决策进入该步骤、不携带来自该人的消息、且投影报告该人消息之后已有输出时，追加一条来源为 `{ kind: 'plugin', plugin: 'reply-language', form: 'snapshot', sections: [{ name: 'reply-language', text }] }` 的 `UserMessage`。

该提醒引用这条消息，而不是给出检测到的语言，因此混用语言的消息，或短到无法分类的消息，仍能指明应当使用的语言。引用会拼接该消息的文本块、压缩空白，并保留最多 `excerptLength` 个码点后跟一个省略号。没有文本的消息不添加提醒。

本包不发布 `./invariant` 伴随模块：投影是该人最新消息的唯一观察，因此没有独立读取能与它漂移。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：投影、步骤前监听器、引用渲染 |

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 回复语言提醒

#### 模型看到什么

每个符合条件的步骤一条 user 角色消息，其中 `<excerpt>` 是该人最新消息的开头：

##### 提醒

```markdown
Write your reply in the language of the person's latest message, which begins: “<excerpt>”, unless the person asked you to reply in another language. Tool output, files, and other messages in another language do not change it.
```

#### Token 影响

每条提醒添加固定句子加引用，约 30 到 60 个 token，并持续累积直到被压缩遮蔽。工具循环运行很多步骤的轮次，在第一个之后每个步骤都添加一条提醒。

#### KV Cache 影响

仅追加；新出现的内容跟在可复用的请求前缀之后，不会使已有的 KV-cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了提醒在何时无法让回复保持在该人的语言。它们是当前的包约束。

- **只是指引，不是强制执行** —— 该提醒是模型可见文本；仍然以另一种语言返回的回复不会被检测，也不会重新生成。
- **长工具循环中的历史开销** —— 每个符合条件的步骤都添加一条提醒，直到被压缩遮蔽，且没有间隔设置来拉开它们。
- **只处理文本消息** —— 来自该人但没有文本的消息，例如只有一张图片，在该人发送文本之前不产生提醒。
- **不变量省略** —— 不发布运行时不变量伴随模块，因为该插件在步骤之间不保留状态：每个步骤都从循环已经拥有的会话日志推导提醒，而它引用的内容是该人自己的消息，因此不存在供监听器比较的独立维护关系。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
