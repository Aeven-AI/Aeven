---
description: "面向在工具调用期间等待的会话的可选提示缓存保温：以一 token 的输出上限重放最近一次对话请求，让下一步落在已缓存的提示前缀上，并记录用量与按提供方配置的存活时长。"
kind: "package-reference"
---

# @aeven/llm-cache-warm

[English](README.md) | 中文

## 概要

提供方只在缓存条目存活期间对缓存前缀计费，有些提供方会在数小时内清除缓存——DeepSeek 并未公布任何存活时长。一次持续数分钟的工具调用会让下一次请求变成全价的前缀读取，尽管对话内容毫无变化。

本插件在工具调用进行期间，以一 token 的输出上限重放该会话最近一次对话请求，使前缀保持缓存，循环随后追加的工具结果也落在其上。会话在等待人类时不做保温，未配置间隔的提供方不做保温，前缀小到缓存命中无意义时也不做保温。每次保温都会连同提供方上报的用量一起记入日志。它以停用状态发布，没有任何随附 profile 启用它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时选用

当部署在提示缓存寿命长于单次请求、却短于一次长时间等待或短于提供方自身 TTL 的提供方上运行长工具调用——构建、测试套件、浏览器操作、子代理——时选用本包。保温是一次下注：缓存熬过等待且下一次请求复用它时它才划算；没有复用时，每次都要付一次缓存前缀读取加一个输出 token。对始终受模型限制的工作负载没有帮助，也绝不会对部署未定价的请求保温。

### 最小配置

```yaml
- id: llm-cache-warm
  plugin: '@aeven/llm-cache-warm'
  config:
    providers:
      deepseek:
        intervalMs: 240000
      openrouter:
        intervalMs: 120000
        maxPings: 3
```

`intervalMs` 必须低于提供方的缓存存活时长，并留出一次请求的往返余量；在被清除之后才落地的保温，只会白付全价。`excludeTools` 默认是 `['ask_user_question']`——唯一一个其阻塞点是人类在做决定而非工作在进行中的工具。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 设计概念

两个监听器加一个私有状态机。`llm/stream` 记录保温将要重放的请求——从不记录辅助调用（带 `purpose`）、从不记录携带 file 或 image 区块的请求、从不记录低于 `minPrefixChars` 的请求——`tools/execute` 在一次工具调用期间打开保温窗口，并统计嵌套子调用，因此一段 `run_code` 程序只维护一个窗口，而不是按每个绑定调用重启。

窗口内有一个定时器每 `intervalMs` 触发：追加 `cache-warm/start`，把捕获的请求以 `maxTokens: 1` 经同一条 LLM waterfall 发出，将流折叠进 `BlockAssembler` 以取得用量，再追加带该用量或失败原因的 `cache-warm/result`。保温请求不携带 `sessionId`——它不得触发持久化 flush——并原样复用捕获的选项，因此提供方看到的前缀逐字节一致。

三个上限让支出可预期：每次工具调用的 `maxPings`、跨会话的 `maxConcurrentPings`、每个 UTC 日的 `dailyPingBudget`。工具自身的 signal 会取消进行中的保温，因此提前结束的阻塞点立刻停止付费。

缓存存活时长是提供方的事实，因此属于配置而非常量：部署为某个提供方给出间隔，插件才会为该提供方保温。

### 源码导览

- `src/index.ts` —— 插件标识、配置 schema、两个 waterfall 监听器，以及 `SessionEventMap` 成员。
- `src/warmer.ts` —— 捕获、窗口状态、定时器、分发与每日预算。
- `src/types.ts` —— `cache-warm/start` 与 `cache-warm/result` 的负载类型。
- `@aeven/token-meter` —— 把 `cache-warm/result` 的用量折叠进会话的 `tokenUsage` 总计，于是保温支出出现在回合支出所在之处。

-----

<a id="further-exploration"></a>
## 进一步探索

- 本设计参照的实测试点：DeepSeek harness 的 `dsh-warm` 0.2.0，它报告 50 天内空闲保温节省 $6.91，而在工具结果阻塞保温的情况下多花 $7.15。
- DeepSeek 之外、公开说明"数小时到数日内清除"之外的缓存存活时长：设置 `intervalMs` 前请查阅提供方自己的文档。

-----

<a id="model-experience"></a>
## 模型体验

### 保温请求

#### 模型看到什么

什么也看不到。保温的响应在插件内部被耗尽，因此没有助手消息、没有工具调用、也没有提示改动进入对话。这两个事件只存在于日志：没有任何模型请求由它们构造，也没有任何投影渲染它们。保温不能开启回合、不能引导 agent、也不会出现在转录中。

#### Token 影响

每次保温一次 `maxTokens: 1` 的补全，外加对整个捕获前缀的一次缓存前缀读取。插件只在已配置的提供方上、只在工具调用期间、且只在 ping、并发与每日预算之内支出这些费用。

#### KV Cache 影响

它存在的目的就是保住 KV 缓存：除输出上限外，前缀逐字节重放，于是缓存条目是被刷新而不是过期。若前缀已被清除，保温就是白费的工作，这正是 `intervalMs` 必须带余量地低于提供方存活时长的原因。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **不实现空闲保温。** 等待人类的会话——模型已回复、没有请求在进行——不被保温，尽管那往往是最长的等待。能证明其价值的度量是 `dsh-warm` 为其 streaming 模式所做的那一次；在有部署报告之前，插件只停留在工具阻塞点内。
- **提供方存活时长需手工配置。** 没有任何随附的提供方客户端公布提示缓存 TTL，因此 `intervalMs` 是部署自己的估算，而不是适配器能提供的值。
- **保温无法重新上传文件。** 携带 file 或 image 区块的请求永不被捕获，因此靠附件工作的会话什么也不保温。
- **前缀是测量而非计数的。** `minPrefixChars` 比较系统提示、工具 schema 与消息的字符数；分词器更精确，但不值得为此增加一个依赖。
- **不回读缓存指标。** 插件记录一次保温花了多少，而不是其后请求是否命中；要证明节省需要提供方自己的缓存命中计数。
