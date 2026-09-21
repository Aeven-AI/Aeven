---
description: "把公开的桌面任务集（OSWorld、MacAgentBench、WindowsAgentArena）归一化为一份任务意图目录。"
kind: "package-reference"
---

# @aeven/computer-use-tasks

[English](README.md) | 中文

## 概述

三个公开基准用三种不同的 JSON 形态描述桌面工作，但在关键点上是一致的：一条指令、它涉及的应用程序、环境如何准备，以及结果依据什么来检查。本包把三者读入同一条记录，使它们可以作为单一意图来源使用。

**基准任务是一种意图，而不是配方。** 配方声明一个有参数的操作以及如何校验它；基准任务声明一个目标、一个准备好的初始状态与一个终态检查，并通过智能体自行发明的任意 UI 序列达成。因此这里诚实的产出是一份**目录**：应用域、指令，以及终态检查所揭示的语义词汇，配方由此人工整理而成。声称能从指令文本机械地翻译出操作，只会产生自信的胡说。

读取真实数据集的结果是 **1,199 条意图，零解析失败**：OSWorld 369 条、MacAgentBench 676 条、WindowsAgentArena 154 条。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

数据源是获取而来而非内置的——约 9 MB 的 JSON，且其许可证不允许我们再分发。对任务目录做稀疏克隆即可：

```bash
npx tsx packages/computer-use/computer-use-tasks/examples/catalog.ts \
  <osworld>/evaluation_examples/examples \
  <macagentbench>/tasks \
  <windowsagentarena>/src/win-arena-container/client/evaluation_examples_windows/examples \
  task-intent-catalog.md
```

或从代码调用：

```ts
import { readTaskSets, normalizeIntents, groupByApp } from '@aeven/computer-use-tasks'

const { intents, failures } = readTaskSets([
  { root: '/path/to/OSWorld/evaluation_examples/examples', source: 'osworld' },
  { root: '/path/to/MacAgentBench/tasks', source: 'macagentbench' },
])

for (const [app, tasks] of groupByApp(normalizeIntents(intents))) {
  console.log(app, tasks.length)
}
```

<a id="understand-the-implementation"></a>
## 理解实现

### 每个数据源贡献什么

| 数据源 | 任务数 | 最强贡献 |
| --- | --- | --- |
| OSWorld | 369 | LibreOffice 深度——归一化后 Calc 100、Writer 66、Impress 55 |
| MacAgentBench | 676 | macOS 广度，覆盖 25+ 应用程序，其检查直接指明语义终态 |
| WindowsAgentArena | 154 | Windows 应用覆盖，采用 OSWorld 的形态 |

### 第四个数据源：语义工具目录

`X-PLUG/OSWorld-MCP` 按应用程序发布了一份经过验证的语义操作清单，采用 OpenAI 函数调用形态——名称、描述与参数模式。这与任务属于不同种类的证据：任务说明*用户想要什么*，工具说明*应用程序可以被要求做什么*，并且参数名已经确定。因此它被作为独立数据源读取，而不是并入任务记录。

在已发布的目录上测得：横跨 LibreOffice Calc（26）、Impress（21）、Writer（15）、Chrome（12）、VLC（12）、VS Code（20）以及操作系统工具，共 **132 个操作**。

曾编写过一个按名称重叠来报告配方集未覆盖哪些操作的启发式方法，随后又**将其移除**：它把 `save` 报为未覆盖，而对应配方的名称是 `spreadsheet.saveAs`。一份凭空造出缺口的覆盖报告比没有更糟，因此覆盖情况改为在 `@aeven/computer-use-router` 的能力模型中显式声明。

### 终态检查词汇是最有价值的部分

名为 `calendar_check_weekly_event` 的检查直接陈述语义终态——具有给定名称、小时与星期的事件——而这正是配方校验所需要的词汇。因此目录记录了每个检查名，而它们的集合显示了这些数据源共同知道如何校验哪些终态，从而显示哪些配方可以携带真正的断言，而不是「文件存在」这类替代品。

在真实数据集上测得，断言实际内容的检查以 `compare_table`（85 个任务）、`compare_pptx_files`（49）、`find_str_in_list`（44）、`compare_docx_files`（21）、`calendar_check_weekly_event_advanced`（17）与 `compare_pdfs`（14）为主。

### 域在分组前先归一化

各数据源用多种方式书写同一个应用程序——LibreOffice Calc 会写作 `libreoffice calc`、`libreoffice_calc` 与 `libreoffice-calc`——并在同一字段中携带测试框架的产物：最大的原始「域」是 `terminal_no_reset`，那是 244 个快照设置了重置标志的任务，而不是这些任务所涉及的应用程序。

若放任不管，这两个问题会以特定方式误导：计数正是读者用来决定投入方向的依据，因此被拆分的计数会低估某个应用，而框架产物会高估某个应用。归一化在分组之前运行，**265 条仅含框架标记的意图被明确排除**，且每一次重命名都被报告出来，而不是静默应用。

### 不会有任何东西被悄悄丢弃

不是任务的 JSON 文件（没有 id 与指令对）会被*跳过*；无法解析的文件则是*失败*，连同路径与原因一并报告。静默省略无法读取内容的目录会低估数据源，而计数正是读者用来判断目录是否值得信任的依据。在真实数据集上：零失败。

<a id="further-exploration"></a>
## 延伸阅读

- [`@aeven/computer-use-router`](../computer-use-router/README.zh.md) —— 由本目录整理而成的配方。
- [`@aeven/computer-use-benchmark`](../computer-use-benchmark/README.zh.md) —— 配方所覆盖任务的步骤计数。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **它产出目录，而不是配方。** 把指令映射为操作属于人工整理。只有检查名是机械可得的，而且只有其中一部分对应我们能够执行的操作。
- **应用名不是 bundle id。** 归一化规范的是拼写而不是身份；把 `pages` 映射到 `com.apple.Pages` 是另一项决定。
- **数据源是获取的而非内置的**，因此这些数字可由运行器复现，但不在仓库中。
- **三分之二的意图没有配方，也可能永远不会有。** 其中许多是 Chrome、GIMP、VLC 或框架任务，超出本技术栈当前范围，另有 265 条完全不涉及应用程序。
- **部分检查属于框架内部。** `sleep`、`execute` 与 `activate_window` 之所以作为检查出现，是因为数据源复用了评测器数组来做准备；目录会报告它们，读者需要知道它们并不是终态断言。
- **未跨数据源去重。** 同一个 LibreOffice 任务可能出现在多个基准中，因此总数并非不同任务的数量。
- **工具目录是能力，而不是任务。** 它们说明某个操作存在以及它的名称；它们不说明有用户提出过该需求，也不携带终态检查。

<a id="dev-note"></a>
## 开发备注

导入器在首次运行时发现了一个数据源之间真实的不一致：OSWorld 把评测器的 `func` 写成**字符串**，MacAgentBench 则写成**数组**。一个同时容忍两者的适配器把它们读作同样的东西，并由一个测试固定下来。

最有用的产出不是 1,199 这个数字，而是两个修正数字：265 条被作为仅含框架标记而排除的意图，以及把被拆分的 `libreoffice-calc` 计数 22 + 11 + 67 变成诚实的 100 的那些重命名。两者之所以存在，是因为原始计数会在代价高昂的方向上误导——低估该投入之处，高估不该投入之处。

**运行时不变式：** 不发布伴随插件，因为本包以纯函数导入基准任务集并把它规范化为意图，因此它没有可比较的运行时序列，也没有需要维护的可变关系。
