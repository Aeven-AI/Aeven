---
description: "基于桌面适配器的批量计算机操作会话：每次调用执行多个步骤，并把树的变化以增量而非整棵树报告。"
kind: "package-reference"
---

# @aeven/computer-use-session

[English](README.md) | 中文

## 概述

最大的步骤节省就发生在这一层，而它并不在适配器里。

某个参考实现把计算机操作暴露为**面向会话的单个代码工具**，而不是每个操作一个工具，并且它自身的指引就是批量提交相关输入，因为状态捕获是昂贵的。本包就是这个会话：`run()` 接收多个步骤并返回一个结果，因此 N 个操作只需一次往返而不是 N 次。

它还会记住上一次观察，因此重复查看会报告**增量**而不是重发整棵树——一个文档窗口可能发布数百个节点，而其中几乎全部都没有变化。它还把校验带入批次，使"是否成功"成为结果的一部分，而不是另一次调用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发者说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
import { ComputerUseSession } from '@aeven/computer-use-session'

const session = new ComputerUseSession({ book, adapter, handlers })

const batch = await session.run([
  { kind: 'execute', request: { task: 'document.createText', platform: 'darwin', app: 'com.apple.Pages', parameters: { path, text } } },
  { kind: 'observe' },
  { kind: 'readiness' },
])

batch.verified  // every executed task verified, so the batch is trustworthy
batch.results   // one entry per step, tagged by kind
```

## 理解实现

### 一次调用，多个步骤

`run()` 按顺序执行步骤，并在**第一个失败处停止**。批次中靠后的步骤几乎总是依赖靠前的步骤已经成功，因此继续执行会作用于一个从未到达预期状态的界面。

### 增量只有在针对同一对象时才有意义

差分按**位置**比较，而不是按令牌。令牌内嵌其快照 id，因此跨两次观察比较令牌会把每个节点同时报告为被移除又被新增——一个看起来忙但实际上毫无信息的增量。

只有当两次观察覆盖相同的窗口时才比较位置；不同的窗口意味着不同的遍历，因此该情形会报告完整的树。差分通过 `complete` 表明属于哪一种，因此调用方永远不必从内容去推断"一切都是新的"。

### 未变化的节点以位置形式报告

未变化的节点上没有可操作的内容，而且它会携带调用方已经持有的令牌。差分把它们报告为索引，而**已变化**的节点会携带其当前令牌，也就是操作现在必须使用的那个。

## 延伸阅读

- [`@aeven/computer-use-executor`](../computer-use-executor/README.zh.md) —— `execute` 步骤所经过的执行器。
- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.zh.md) —— 本会话用于观察与校验的适配器契约。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **尚未接入面向模型的工具。** 这是消费方会暴露的会话对象；目前没有任何东西把它注册为 `run_code` 风格的绑定或模型工具。
- **没有持久内核。** 会话位于宿主进程中，这正是让批次可以共享状态、同时代码运行时保持无状态且可从日志重建的原因。
- **没有等待策略。** `isQuiet(diff)` 为调用方提供了轮询直到界面稳定的信号，但没有任何东西自动等待它。
- **步骤不可恢复。** 在失败步骤处停止的批次会报告已完成的内容并返回；重新运行会重复那些已经成功的步骤。
- **刻意没有桌面独占性**：会话是调用方的上下文，而不是对机器的占用声明。

<a id="dev-note"></a>
## 开发者说明

第一版差分实现按令牌比较，其错误方式看起来却是对的：测试失败的原因是每次重新观察都把整棵树报告为新增。这正是那种会静默上线的缺陷——增量非空、形态合理、却毫无用处。改为按位置比较修复了它，而不同窗口的检查则避免在不相关的遍历之间比较位置。

`isQuiet` 的存在，是因为空的增量比固定睡眠更廉价也更可靠的就绪信号，而实测运行中大部分挂钟时间正花在固定睡眠上。
