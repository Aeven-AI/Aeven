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

这一区分对 Office 集合尤为关键。它是此处最大的一组配方，也是最容易被不加检查就信任的一组，正因如此每个条目都带有 `documented`，并且有测试断言其中没有任何一个声称相反。

### 常用应用程序集合来自对公开任务集的整理

这些配方不是凭空发明的；每一条都可追溯到某个公开基准中**具名的终态检查**，这正是它们能够拥有真正断言的原因。`calendar_check_weekly_event_advanced` 指明事件、时间与星期；`new_apple_notes_check_note_exists_in_folder` 指明笔记及其文件夹；`clock_check_clock_timer_value` 指明计时器。因此 `calendar.createEvent` 校验 `calendarHasEvent`，`notes.createNote` 校验 `noteExists`，`clock.createAlarm` 校验告警集合中的 `appObject`。

有两处边界被明确说明而非隐藏，且测试确保二者都不是图方便：

- **Calculator 不提供脚本字典**，因此其显示内容无法以编程方式读取。该配方通过标准库精确计算表达式，并把 `calculator.readDisplay` 声明为盲点，因为一个声称能读取自己读不到的显示内容的配方，比一个承认该缺口的配方更糟——调用方会信任那个答案。
- **Pages 文档是一个包**，因此无法通过搜索容器来断言其正文文本。该配方检查写入的字节，并把语义回读留给消费方。

测试还会拒绝任何几乎对一切都通过的检查：不会发布空字符串的子串断言，因为一个无法失败的校验比没有校验更糟。

### Pages 的模板步骤是显式的，因为数据源揭示了它

基准中关于 Pages 的指令很具体：*"Create a new document using the template 'Blank Black' and name it …"*。这解决了一个在本机直接测得的问题：Creator Studio 的模板选择器只暴露两个辅助功能元素，而把文档创建当作单次调用的做法永远无法越过它。`document.createFromTemplate` 把模板作为参数，因此该步骤是被命名的，而不是一个意外。

### Office 与 LibreOffice 刻意走语义路径

在 Windows 上一次单元格写入是一次 COM 成员调用，在 Linux 上是一次 UNO 调用，而在功能区完成同一操作则是一连串点击、按键与对话框。任务词汇已与 `microsoft/cua_skill` 按应用程序划分的动作模块交叉核对，那些模块从 UI 侧枚举了相同的操作——但此处的配方通过应用程序自身的 API 实现它们，而不是组合 UI 步骤，因为步骤节省正来自于此。

唯一的例外是 macOS 的格式设置：Pages 脚本桥接完全无法触及段落与字体属性，因此 `document.setFont` 在那里解析到辅助功能层级，并在 `knownBlind` 中说明这一点。

### 拒绝会列出已搜索的内容

未知任务会报告本书已知的任务。没有配方的平台会报告该任务确实覆盖的平台。未被覆盖的应用程序会报告它确实覆盖的应用程序。覆盖列表已去重，因此拥有多个调用的平台只被列名一次。

## 延伸阅读

- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.zh.md) —— 配方的 `verify` 所使用期望所属的契约。
- [`@aeven/computer-use-macos`](../computer-use-macos/README.zh.md)、[`@aeven/computer-use-windows`](../computer-use-windows/README.zh.md) 与 [`@aeven/computer-use-linux`](../computer-use-linux/README.zh.md) —— 各层级解析到的适配器。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **路由器只做选择，不做执行。** 解析结果只指明机制与操作，由拥有该机制的消费方执行。尚无执行器接入。
- **本书是起始集合**——32 个任务：文件系统操作、Pages、Mail 与 Calendar；13 个 Office 与 LibreOffice 任务，覆盖 Excel、Word、PowerPoint、Calc、Writer 与 Impress；以及 12 个经过整理的通用的应用程序任务，覆盖 Calculator、Clock、Calendar、Notes 与 Pages。其它一切都会拒绝。
- **Windows 与 Linux 条目未经验证。** COM 与 UNO 稳定且文档完备，其操作也是它们的标准入口，但此处尚未驱动过真实的 Office 或 LibreOffice，因此其 `evidence` 为 `documented`。在真实宿主上验证被刻意推迟到后续阶段，而不是现在声称已完成。
- **Office 任务的校验刻意较粗。** OOXML 与 ODF 都是容器，因此对其字节做文本搜索会因错误的原因而通过；这些配方只断言文件已写入，内容检查留给消费方自己的语义回读。只有 PDF 导出会断言内容，因为 PDF 可以通过自身字节来检查。
- **不随包提供任何 Office 或 LibreOffice 机制处理程序。** 这些配方解析到 `com` 与 `dbus`，而执行器会拒绝没有处理程序的机制，因此当前运行它们需要消费方注册该处理程序。
- **没有层级降级图。** 配方列出它提供的层级，但尚无法表达"先试辅助功能，若元素不存在则降到视觉"。这需要数据模型所不具备的按任务条件逻辑。
- **期望中的占位符不会被替换。** 配方使用 `{path}` 形式的参数，填入它们是消费方的职责。

<a id="dev-note"></a>
## 开发者说明

配方承载着本技术栈其余部分所依赖的实测结论，这正是它们位于包中而不是文档中的原因：Pages 的内容写入是一次调用且回读逐字节一致，Pages 脚本桥接完全丢失段落处理能力，而 Mail 必须按邮箱读取未读数，因为应用级调用会抛出异常。这些事实作为数据是可测试的，测试也对其作出断言。

拒绝消息是在测试发现某个平台因每个调用而重复一次之后去重的。那份失败输出值得细读，而不是放宽断言。
