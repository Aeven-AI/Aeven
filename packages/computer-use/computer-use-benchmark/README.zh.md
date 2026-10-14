---
description: "计算机操作任务的步骤数基准：测量本技术栈需要多少次调用，并与视觉路径的既有记录成本并列。"
kind: "package-reference"
---

# @aeven/computer-use-benchmark

[English](README.md) | 中文

## 概述

本技术栈所服务的目标是"步骤最少"，而在被测量之前这只是一个主观判断。本包给出这个数字。

两类证据被严格区分，因为把它们合并是最容易夸大结果的方式：

- **`measured`（实测）**——任务在此处运行，计数取自机制接缝，而不是信任处理程序自身的报告。这是计数，不是估算。
- **`recorded`（记录）**——视觉路径的基线来自更早的会话，并作为带标注的常量保留。它报告为 `recorded` 而绝不报告为 `measured`，因为本包无法在不让真实桌面走那条失败路径的情况下复现它。

无法在宿主上运行的任务会被报告为**跳过并附原因**，绝不会被省略。一个悄悄丢掉无法触及部分的基准，会夸大它保留下来的一切——而它无法触及的任务，恰恰是那些适配器尚未验证的任务。

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
import { runBenchmark, renderBenchmark } from '@aeven/computer-use-benchmark'
import { STARTER_BOOK } from '@aeven/computer-use-router'

const report = await runBenchmark({
  book: STARTER_BOOK,
  tasks: [
    { task: 'file.exists', platform: 'darwin', parameters: { path: '/tmp' } },
    { task: 'document.createText', platform: 'darwin', app: 'com.apple.Pages', parameters: { path: '/Users/me/Desktop/story.pages', text: 'x' } },
    { task: 'spreadsheet.setCell', platform: 'win32', parameters: { cell: 'A1', value: '1' }, skip: 'no Windows host' },
  ],
})

console.log(renderBenchmark(report))
```

macOS 上的当前输出：

```text
task                          platform   calls  baseline   evidence
----------------------------  ---------  -----  ---------  ----------------------
file.exists                   darwin         1         -   measured / recorded
document.createText           darwin         1  recorded 20 measured / recorded
mail.listAccounts             darwin         1         -   measured / recorded
calendar.list                 darwin         1         -   measured / recorded
spreadsheet.setCell           win32          -         -   skipped: no Windows host available

measured total: 4 call(s) across 4 task(s)
skipped: 1 task(s), each with its reason above
document.createText: 20 recorded vs 1 measured = 20x fewer steps
```

<a id="understand-the-implementation"></a>
## 理解实现

### 计数取自接缝

`measureTask` 包装任务所解析到的机制的处理程序并统计调用，因此该数字是技术栈经由会话、路由器、执行器与处理程序链实际发出的调用数。处理程序报告自己做了多少，并不能作为走了多少步骤的证据。

### 被跳过的任务也是一种结果

当解析或执行失败时，`measureTask` 会报告 `skipped` 及失败原因，而不是零。零会被读作"免费"，与"我们无法查清"恰好相反。

### 比值需要两个数字

当任一数字缺失时 `stepRatio` 返回 `undefined`，并拒绝除以零而不是报告无穷大。只有当任务同时具备实测值与记录基线时才会打印比值。

<a id="further-exploration"></a>
## 延伸阅读

- [`@aeven/computer-use-session`](../computer-use-session/README.zh.md) —— 测量所经过的批量会话层。
- [`@aeven/computer-use-router`](../computer-use-router/README.zh.md) —— 配方及其证据标签。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **只有一条记录基线。** 只有 `document.createText` 具备视觉路径数字，因为它是唯一以另一种方式测量过的任务。其余比值是缺失的，而不是被假定的。
- **测量期间机制是被打桩的。** 计数反映技术栈的调用数；Pages 是否安装在测量宿主上是另一个问题，因此真实的端到端运行放在处理程序的测试套件中。
- **此处只有 macOS 任务会运行。** 在存在宿主之前，Windows 与 Linux 任务会带原因地跳过。
- **尚无 CI 门禁。** 报告按需生成；当步骤数回退时没有任何东西会让构建失败。
- **计数的是机制调用，而不是模型轮次。** 模型轮次数取决于会话层，而该层尚未接入工具。

<a id="dev-note"></a>

<a id="开发备注"></a>

## 开发备注

这个基准刻意无法自我美化。它最有用的性质不是 20 倍这个比值，而是"已跳过，附原因"那一行：它无法触及的两个平台，正是适配器验证最少的两个，而省略它们的基准会用更少的覆盖换一个更漂亮的数字。

基线常量被标注为 `recorded` 而不是 `measured`，因为本包无法复现它。这一区分正是证据字段存在的全部理由：读者能够分辨哪个数字来自运行、哪个来自更早的工作。

**运行时不变式：** 不发布伴随插件，因为本包在测量时统计机制调用次数，并把该次数写入结果，因此伴随插件所要断言的那个数字，正是已经返回的数字。
