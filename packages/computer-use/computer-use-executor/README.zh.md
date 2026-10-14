---
description: "通过其机制执行已解析的配方，并确立任务确实成功，而不是信任处理程序所报告的内容。"
kind: "package-reference"
---

# @aeven/computer-use-executor

[English](README.md) | 中文

## 概述

执行任务，然后确立它确实成功。

它填补了路由器留下的空缺。[`@aeven/computer-use-router`](../computer-use-router/README.zh.md) 解析**应当发生什么**；本包解析任务、把调用交给拥有该机制的处理程序，并**独立**校验结果。

顺序就是关键。处理程序先运行，而它自身的报告仅被视为**参考**——判定来自对可观察对象的重新读取。实测经验对此毫不含糊：某个操作报告 `delivered_count: 42` 而目标文件从未改变，某次保存报告成功却没有写入任何内容。因此 `executeOrThrow` 会抛出 `unverified` 而不是返回一个乐观结果，而被跳过的校验会报告为 `verified: false`，因为**未检查**不等于**已通过**。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
import { TaskExecutor, type MechanismHandler } from '@aeven/computer-use-executor'
import { STARTER_BOOK } from '@aeven/computer-use-router'

// Registered by a consumer: this package runs a mechanism, it does not implement one.
declare const runAppleEvents: MechanismHandler

const executor = new TaskExecutor({
  book: STARTER_BOOK,
  handlers: { 'apple-events': runAppleEvents },   // mechanisms this package does not own
})

const outcome = await executor.executeOrThrow({
  task: 'document.createText',
  platform: 'darwin',
  app: 'com.apple.Pages',
  parameters: { text: 'the story', path: '/Users/me/Desktop/story.pages' },
})

outcome.verified   // true only because the file was re-read from disk
outcome.outcomes   // one result per expectation, with what was actually observed
```

<a id="understand-the-implementation"></a>
## 理解实现

### 只内置一种机制，其余由外部注册

本包刻意**只**实现文件系统。文件系统在每个平台上完全相同，不需要应用程序、不需要权限授予，也不需要 UI，这使它既是最廉价的层级，也是无需真实桌面即可测试的那一层。

其它所有机制——Apple 事件、COM、D-Bus、各类辅助功能树——都以由消费方注册的处理程序形式提供。这是边界，而不是空缺：执行器决定*何时*运行以及*是否成功*，而消费方决定*如何*运行，因为只有它知道哪些应用程序安装在哪些宿主上。没有处理程序的机制会被报告为指明该机制的能力失败，绝不会是静默的空操作。

### 报告仅供参考，判定独立得出

`MechanismResult.observed` 会被带入结果供调用方查看，但从不用于决定任务是否成功。判定来自针对已解析期望运行的 `verify()`。

### 参数同样用于解析检查

配方只编写一次而用于多次调用，因此其期望中包含占位符——`{path}`、`{text}`。同一份取值映射同时填充调用与其检查，因此校验读取的正是任务实际写入的路径。

未填充的占位符是**错误，而不是通配符**。把它解析为空字符串会产生一个几乎对任何内容都通过的检查，而一个无法失败的校验比没有校验更糟，因为它会报告成功。

<a id="further-exploration"></a>
## 延伸阅读

- [`@aeven/computer-use-router`](../computer-use-router/README.zh.md) —— 本包所执行的解析结果。
- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.zh.md) —— 文件系统无法回答的可观察对象所使用的校验器与适配器契约。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **不随包提供任何非文件系统的处理程序。** Apple 事件、COM 与 D-Bus 处理程序必须由消费方注册；在注册之前，使用这些机制的任务会拒绝执行。
- **没有重试或等待策略。** 需要片刻才能稳定的任务——保存对话框关闭、文档正在写入——此处尚无事件驱动的等待，因此调用方必须自行轮询或等待。
- **期望会被解析，但不会按操作做类型核对。** 配方可能为一个从不写入该文件的操作声明 `fileEquals` 检查；在检查失败之前没有任何东西能发现这种不匹配。
- **没有执行日志。** 结果只是被返回而不被持久化，因此批量会话除调用方自留之外没有记录。

<a id="dev-note"></a>

<a id="开发备注"></a>

## 开发备注

测试针对**真实**文件系统运行文件系统机制而非使用 mock，因为被 mock 的写入无法证明写入是否真的落盘。测试套件中最有价值的一个，其处理程序在报告成功的同时写入了别的内容——这正是促成本包的那种失败形态，而它断言即使处理程序很乐观，判定也必须为假。

一个为校验提供适配器的测试最初传入了一个不存在的路径，因此处理程序在校验运行之前就失败了。它被改写为先写入一个真实文件：一个因为前一步抛错而通过的校验测试，并没有在测试校验。

**运行时不变式：** 不发布伴随插件，因为本包执行一个任务，再通过复读一个独立的可观察量来验证它，而这一先后次序正是调用方已经等待的；发布伴随序列只会复述返回值。
