---
description: "Windows 计算机使用的 COM 机制处理器：通过 PowerShell 驱动正在运行的 Office 应用，并报告它观察到的结果。"
kind: "package-reference"
---

# @aeven/computer-use-windows-com

[English](README.md) | 中文

## 概述

Windows 上的 **semantic** 机制，注册到 [`@aeven/computer-use-executor`](../computer-use-executor/README.zh.md)。它通过 PowerShell 针对 Office 应用的自动化对象模型执行配方中的操作，并报告它观察到的结果。

它存在的原因是：在这个平台上，语义层正是收益所在——写入一个单元格只需一次 COM 成员调用，而通过功能区完成同样的工作则是一连串的点击、按键与对话框。当宿主为 `win32` 时，`spreadsheet.*`、`document.*`、`slide.*` 与 `presentation.*` 配方都在这里解析。

有三件事它故意不做。它不把自己的输出当作结论——处理器只负责报告，由执行器通过独立可观察量重新读取来判定。它不会启动应用：配方书中的每个操作都是针对正在运行的实例编写的，因此处理器只做附加，在没有可附加的实例时按名称明确拒绝。它也不会尝试自己未实现的操作，因为一个配方指向没有任何实现的操作是应当暴露出来的缺陷。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```ts
import { TaskExecutor } from '@aeven/computer-use-executor'
import { STARTER_BOOK } from '@aeven/computer-use-router'
import { createComHandler, type ComRunner } from '@aeven/computer-use-windows-com'

declare const runner: ComRunner

const executor = new TaskExecutor({
  book: STARTER_BOOK,
  handlers: { com: createComHandler({ runner }) },
})

await executor.executeOrThrow({
  task: 'spreadsheet.setCell',
  platform: 'win32',
  app: 'Excel.Application',
  parameters: { sheet: 'Sheet1', cell: 'A1', value: '42', path: 'C:\Users\me\Desktop\book.xlsx' },
})
```

运行器由外部注入，因此处理器自身不需要任何进程访问权限，且每一种失败方式都可测试。请提供一个用 PowerShell 7（`pwsh`）或 Windows PowerShell 运行脚本的运行器，并按 [`@aeven/computer-use-windows`](../computer-use-windows/README.zh.md) 的方式解析可执行文件。

| 应用 | 操作所作用的文档 | 保存它的成员 |
|---|---|---|
| `Excel.Application` | `ActiveWorkbook` | `SaveAs2` |
| `Word.Application` | `ActiveDocument` | `SaveAs2` |
| `PowerPoint.Application` | `ActivePresentation` | `SaveAs` |

## Understand the implementation

### 它附加到正在运行的应用，而不是启动一个

配方书中的 Windows 操作会指名 `ActiveDocument`、`Selection` 与 `Presentations`，这些只存在于打开了文档的活动实例上，因此生成的程序会调用 `GetActiveObject`，并在 PowerShell 无法附加时抛出带名称的错误。这也绕开了 PowerPoint 拒绝隐藏运行的限制：若用 `New-Object` 启动应用，就必须先满足这一点才能执行任何操作。

### 值以字面量嵌入，绝不做插值

程序文本由调用方提供的值生成，因此每个值都会经过 PowerShell 单引号字面量并加倍其中的引号。这是 PowerShell 中唯一不做插值的字符串形式：`$name`、反引号与 `"` 都保持字面含义，因此包含 `$(Remove-Item …)` 的单元格会被当作文本写入，而不会被求值。

### 操作本身不保存时，包装层负责保存

配方的验证读取的是独立可观察量，而每个 Office 配方验证的都是文件，因此包装层会通过宿主自身的成员把文档保存到调用方给出的 `path`——`SaveAs2`、`SaveAs` 与 `ExportAsFixedFormat` 除外，因为它们本身就是保存。没有 `path` 的操作不保存任何东西，并让文档保持已修改状态。

### 失败会带上 PowerShell 自己的话

非零退出会原样报告 `stderr`，而没有任何解释的失败会如实说明，而不是产生一条空消息。缺失的参数与未知的应用都会在任何程序运行之前被拒绝。

## Further Exploration

- [`@aeven/computer-use-executor`](../computer-use-executor/README.zh.md) — 本处理器注册到的执行器，以及它本身不做的那部分验证。
- [`@aeven/computer-use-router`](../computer-use-router/README.zh.md) — 本处理器所实现其操作的配方。
- [`@aeven/computer-use-windows-provider`](../computer-use-windows-provider/README.zh.md) — 将本处理器与 Windows 适配器一起挂载的组合。

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **这里的任何操作都尚未在真实的 Excel、Word 或 PowerPoint 上运行过。** 配方书把这些配方标记为 `documented`，本处理器也不声称更多：它的测试针对记录型运行器断言生成的程序与分发行为。仍待验证的是：在装有 Office 的 Windows 主机上，每个操作的成员调用是否被接受，以及随后执行的验证是否读回了该操作写入的内容。
- **`Presentations(item)` 解析为活动演示文稿。** 配方书中该操作的参数列表没有给出条目索引，因此包装层指向 `ActivePresentation`，而不是凭空造一个索引。
- **`Shapes.AddChart2` 以 `-1` 作为样式。** 配方的图表参数给出了图表类型但没有给出样式，而样式正是该成员所必需的实参。
- **每次调用只针对一个应用。** 跨 Excel 与 Word 的批量操作会运行两次调用，因为一个配方只绑定一个应用。
- **自身没有超时。** 阻塞的成员调用——常见原因是 Office 自身的繁忙状态或消息过滤器——由运行器负责设限。
- **不读回已写入的值。** 处理器报告包装层自己的 JSON，由执行器的验证来判定；需要单元格内容的调用方应通过适配器或连接器去索取。

<a id="dev-note"></a>
## 开发备注

宿主应用来自请求的 `app`，由路由器依据配方的 `apps` 条目填充，因此这三个自动化标识符是唯一被接受的值，第四个会按名称被拒绝，而不是被猜测。

调用方传入的路径与配方 `fileExists` 预期解析的是同一个值，这也是包装层要通过文档成员保存、而不是把这个步骤留给调用方的原因：一个因为没有任何保存而永远无法通过验证的任务，就是一个永远失败的任务。

**运行时不变式：** 不发布配套不变式，因为该包只生成程序文本并返回其输出流；唯一的顺序是一次对运行器的调用，而调用方本身已在等待它。
