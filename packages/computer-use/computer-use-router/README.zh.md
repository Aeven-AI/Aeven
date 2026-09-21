---
description: "计算机操作的配方路由：由哪一层执行任务、在哪个平台、在哪个应用程序中，以及之后必须独立成立的是什么。"
kind: "package-reference"
---

# @aeven/computer-use-router

[English](README.md) | 中文

## 概述

决定**由哪一层执行任务**——语义应用程序 API、辅助功能树，还是视觉——并在无法确定时拒绝而不是猜测。

知识存放在配方中，而配方是数据：针对某一应用程序上的某个任务，配方声明层级、机制、操作、覆盖的应用程序、之后必须独立成立的条件，以及**该机制无法做什么**。路由器本身不含任何按应用程序区分的逻辑，因此"这里哪一层胜出"可以在一处审阅，而不是散落在条件分支里。

三条规则塑造解析过程，每一条都来自实测的失败：

- **优先使用可用的最高层级。** 在同一任务上，选择语义层与选择视觉的差别是一次调用与二十余次调用。
- **绝不静默降级。** 只有在配方声明了更低层级，或宿主报告更优层级不可用时，才沿阶梯下行——绝不悄悄进行，因为静默降级在结果出错之前与成功无法区分。
- **绝不虚构覆盖范围。** 未知的任务、平台或应用程序都会产生一个列出已搜索内容的拒绝。

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
import { RecipeRouter, STARTER_BOOK } from '@aeven/computer-use-router'

const router = new RecipeRouter(STARTER_BOOK)
const resolved = router.resolve({ task: 'document.createText', platform: 'darwin', app: 'com.apple.Pages' })

resolved.rung        // 'semantic' — take the cheapest layer that works
resolved.invocation  // { mechanism: 'apple-events', operation: 'Document().make(); …' }
resolved.knownBlind  // ['document.applyFont', 'template.choose']
resolved.verify      // expectations to check independently after it runs
```

从桌面适配器的就绪报告中取得 `availableRungs` 并传入，可让解析对宿主实际能做什么保持诚实：

```ts
router.resolve({ task: 'document.setFont', platform: 'darwin', availableRungs: ['vision'] })
```

## 理解实现

### 阶梯，以及顺序为何重要

`RUNG_ORDER` 依次为语义、辅助功能、视觉。解析沿此行走，取配方提供的、宿主可用的第一个层级。同一层级内的并列由配方自身的顺序决定，因此配方无需发明新层级即可表达偏好。

### `knownBlind` 不是装饰

它与 `rung` 同等重要。它正是阻止路由器在用户面前才发现盲点的东西。Pages 配方说明了原因：内容可通过一次 Apple 事件调用取得，但脚本桥接完全无法触及段落与字体属性——因此 `document.applyFont` 在语义条目上被声明为盲点，并解析到辅助功能层级，而不是先尝试再失败。

### 证据被标记，且各标记并不等价

每个调用都被标记为 `verified`（在本机运行并回读）或 `documented`（来自已发布的 API，此处尚未运行）。消费方不得将两者等同呈现。macOS 的 Pages、Mail 与 Calendar 条目为已验证；Windows 的 COM 与 Linux 的 UNO 条目仅为已记录。

### 拒绝会列出已搜索的内容

未知任务会报告本书已知的任务。没有配方的平台会报告该任务确实覆盖的平台。未被覆盖的应用程序会报告它确实覆盖的应用程序。覆盖列表已去重，因此拥有多个调用的平台只被列名一次。

## 延伸阅读

- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.zh.md) —— 配方的 `verify` 所使用期望所属的契约。
- [`@aeven/computer-use-macos`](../computer-use-macos/README.zh.md)、[`@aeven/computer-use-windows`](../computer-use-windows/README.zh.md) 与 [`@aeven/computer-use-linux`](../computer-use-linux/README.zh.md) —— 各层级解析到的适配器。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **路由器只做选择，不做执行。** 解析结果只指明机制与操作，由拥有该机制的消费方执行。尚无执行器接入。
- **本书是起始集合**，涵盖文件系统任务、Pages、Mail、Calendar，以及 Office 的电子表格、文档与幻灯片。其它一切都会拒绝。
- **Windows 与 Linux 条目未经验证。** COM 与 UNO 稳定且文档完备，但此处尚未驱动过任何一方，因此其 `evidence` 为 `documented`。
- **没有层级降级图。** 配方列出它提供的层级，但尚无法表达"先试辅助功能，若元素不存在则降到视觉"。这需要数据模型所不具备的按任务条件逻辑。
- **期望中的占位符不会被替换。** 配方使用 `{path}` 形式的参数，填入它们是消费方的职责。

<a id="dev-note"></a>
## 开发者说明

配方承载着本技术栈其余部分所依赖的实测结论，这正是它们位于包中而不是文档中的原因：Pages 的内容写入是一次调用且回读逐字节一致，Pages 脚本桥接完全丢失段落处理能力，而 Mail 必须按邮箱读取未读数，因为应用级调用会抛出异常。这些事实作为数据是可测试的，测试也对其作出断言。

拒绝消息是在测试发现某个平台因每个调用而重复一次之后去重的。那份失败输出值得细读，而不是放宽断言。
