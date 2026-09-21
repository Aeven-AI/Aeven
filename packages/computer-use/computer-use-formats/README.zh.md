---
description: "文件格式配方：无需启动应用程序即可生成与读取文档、工作簿、演示文稿与 PDF。"
kind: "package-reference"
---

# @aeven/computer-use-formats

[English](README.md) | 中文

## 概述

这些配方生成与读取**文件**，从不接触正在运行的应用程序。这正是它们在交付物是文件时胜出的原因：无需安装 Office、无需运行中的进程、无需权限授予，并且通过回读结果来完成校验。

该做法取自 Anthropic 随其桌面应用一同提供的文档技能——`docx`、`xlsx`、`pptx`、`pdf` 与 `pdf-reading`——它们是唯一覆盖这些操作的数据源。它们也独立得出了本技术栈的校验规则：其电子表格技能把重算设为强制步骤，并警告干净的退出码并不等于干净的文件，因为报告了错误的运行仍然以零退出。

**这些配方需要本机没有的工具。** 在本机测得：`soffice` 就绪，而 `pandoc`、`openpyxl`、`python-docx`、`python-pptx`、`pdfplumber` 与 `markitdown` 全部被阻塞——**7 个中有 6 个**。因此每条配方都携带就绪要求，`missingTools()` 会在任务运行*之前*拒绝它，并指明缺失的工具及其补救方式。

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
import { probeFormatReadiness, missingTools, FORMAT_RECIPES } from '@aeven/computer-use-formats'

const report = await probeFormatReadiness(runner)
// format.soffice       ready
// format.pandoc        blocked
// format.openpyxl      blocked
// …

missingTools('spreadsheet.createWorkbook', report)  // ['soffice', 'openpyxl']
```

报告是一个 `ReadinessReport`，因此它与适配器契约的形态一致，且每个缺失的工具都携带自己的补救方式。

<a id="understand-the-implementation"></a>
## 理解实现

### 格式层与应用层并存

它们**并不重叠**。一个生成文件；另一个改变用户*已打开*的内容。当交付物是文件时，经由本层更廉价——无需安装 Office、无需运行中的进程、无需授权，而且结果可以通过回读来校验。而实时且未保存的文档只能通过应用层触及。决定性的问题在于交付物是什么，它应当作为路由中独立的一层。

### 要求是推导出来的，而不是写两遍

`requiredTools()` 从每条配方自身的操作文本中读出所需工具，而不是取自可能与其偏离的平行清单。`spreadsheet.createWorkbook` 解析为 `['soffice', 'openpyxl']`，因为它的操作就是这样写的。

### 重算是强制的，盲点说明了原因

`openpyxl` 把公式存储为**没有缓存值**的字符串，因此在工作簿被重算之前，任何读取缓存值的工具——`pandas`、`load_workbook(data_only=True)` 以及大多数预览器——读到的每个公式单元格都是空的。因此该配方把 `spreadsheet.writeWithoutRecalculating` 声明为盲点，并对结果运行 `soffice --headless`。

### 只有一种转换以内容为断言

PDF 可以通过其自身字节来检查，因此 `document.convertToPdf` 断言 `%PDF`。其余配方断言**容器部件名**——`xl/workbook.xml`、`word/document.xml`——因为 OOXML 文件是 zip，对其字节做文本搜索会因错误的原因而通过。有测试确保不会发布空字符串检查，因为一个无法失败的校验比没有更糟。

<a id="further-exploration"></a>
## 延伸阅读

- [`@aeven/computer-use-router`](../computer-use-router/README.zh.md) —— 本层所补充的应用操作配方。
- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.zh.md) —— 本层所使用的就绪与校验形态。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **本机上有七个工具中的六个被阻塞**，因此这些配方大多还无法在此运行。就绪报告会指明每一个及其补救方式；不会在使用点上失败。
- **尚未接入执行器。** 这些是 `filesystem` 机制的配方，而执行器内置的文件系统处理程序只实现了 `readFile`、`stat` 与 `writeFile`——因此它会拒绝这些操作。格式处理程序尚未编写。
- **按设计不含布局。** 布局能力由 Codex 的幻灯片布局目录胜出，此处不重复实现。
- **没有 OCR。** `pdf.extractText` 读取文本层并把 `pdf.ocrScannedPages` 声明为盲点；扫描页需要栅格化，而本层与本机都没有 OCR 工具。
- **`presentation.readText` 是只读的。** 从布局创建演示文稿属于布局层，而不是这里。

<a id="dev-note"></a>
## 开发备注

`PlatformInvocation` 类型禁止顶层 `mechanism` 字段，这一点在此处得到了回报：新增十八条配方一次性产生十八个类型错误，每个都指向那个冗余字段，而不是十八处需要评审者自行发现的静默重复。

即使工具缺失，就绪探测这一部分也值得保留。一条在任务内部以"command not found"失败的配方，正是本技术栈致力于消除的那种不可读失败；取而代之的是，报告会说明 `format.pdfplumber` 被阻塞以及如何安装它。

**运行时不变式：** 不发布伴随插件，因为本包声明文件格式配方并报告哪些工具存在，两者都是返回的数据，因此没有任何效应次序可供监听器断言。
