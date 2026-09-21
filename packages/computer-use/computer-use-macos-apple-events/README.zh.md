---
description: "用于 macOS 计算机操作的 Apple 事件机制处理程序：经由 osascript 运行实测的一次调用文档路径，以及 Mail 与 Calendar 配方。"
kind: "package-reference"
---

# @aeven/computer-use-macos-apple-events

[English](README.md) | 中文

## 概述

macOS 的**语义**机制，注册到 [`@aeven/computer-use-executor`](../computer-use-executor/README.zh.md)。它经由 `osascript` 运行配方的操作并报告其观察到的内容。

它存在的原因，是本机制的收益是被实测的而不是被假定的：创建一个包含文本的 Pages 文档用这种方式是**一次调用**，而通过辅助功能树完成同一任务需要二十余次调用且未能成功。Pages、Mail 与 Calendar 配方都解析到这里。

它刻意不做两件事。它不把自己的输出当作判定——处理程序只做报告，执行器通过重新读取独立可观察对象来判定。它也不尝试配方声明为盲点的操作：脚本桥接无法执行的操作会在到达本处理程序之前被解析到另一个层级。

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
import { TaskExecutor } from '@aeven/computer-use-executor'
import { STARTER_BOOK } from '@aeven/computer-use-router'
import { createAppleEventsHandler, type AppleEventsRunner } from '@aeven/computer-use-macos-apple-events'

declare const runner: AppleEventsRunner

const executor = new TaskExecutor({
  book: STARTER_BOOK,
  handlers: { 'apple-events': createAppleEventsHandler({ runner }) },
})

await executor.executeOrThrow({
  task: 'document.createText',
  platform: 'darwin',
  app: 'com.apple.Pages',
  parameters: { path: '/Users/me/Desktop/story.pages', text: 'The Cartographer of Small Hours' },
})
```

运行器是注入的，因此处理程序自身不需要进程访问权限，且每种失败模式都可测试。请提供一个外壳调用 `osascript -l JavaScript` 的运行器。

<a id="understand-the-implementation"></a>
## 理解实现

### 取值以字面量嵌入，绝不插值

脚本文本由调用方提供的取值生成，因此使用 `JSON.stringify` 而不是手工转义。它对任何输入都能产生合法的 JavaScript 字符串字面量——引号、反斜杠、换行、非 BMP 字符——因此包含引号的文档无法逃逸出它被粘贴进去的那个字面量。

### 一次调用，并且自我回读

文档操作在单个脚本中完成创建、写入、保存并回读正文文本。这正是分层设计所依赖的实测结论，因此它被保留为一次调用而不是被拆分。

### 失败会带上应用程序自己的措辞

非零退出会原样报告 `stderr`，而没有给出任何说明的失败会如实说明，而不是产生一条空消息。无法识别的操作会在任何脚本运行之前被拒绝，因为一个配方命名了无人实现的操作是值得暴露的缺陷。

<a id="further-exploration"></a>
## 延伸阅读

- [`@aeven/computer-use-executor`](../computer-use-executor/README.zh.md) —— 本处理程序注册到的执行器，以及它自身不做的校验。
- [`@aeven/computer-use-router`](../computer-use-router/README.zh.md) —— 本处理程序所实现操作所属的配方。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **已验证的操作就是被实测的那些。** 文档创建、Mail 账户与收件箱主题、以及 Calendar 列表。其它操作会拒绝而不是猜测。
- **只脚本化当前最前台的应用程序。** 多窗口的 Pages 文档按应用程序寻址，而不是按特定窗口。
- **自动化权限按目标应用程序授予**，因此每个新脚本化的应用首次都会带来一次确认对话框。
- **派生的辅助进程持有自己的授权。** `osascript` 无法使用 Æven 的辅助功能授权，而 Apple 事件权限属于发送事件的那个二进制文件。由原生辅助程序经由 ScriptingBridge 发送事件，正是把这一切收敛为单一主体的方式。
- **自身没有超时。** 挂起的脚本需要由运行器来设定边界。

<a id="dev-note"></a>
## 开发备注

端到端路径在提交之前已被真实运行：配方 → 路由器 → 执行器 → 本处理程序 → 校验，产出了一个 92,896 字节的 Pages 文档，随后由 Pages 回读为恰好 `The Cartographer of Small Hours`，31 个字符，两个期望都从磁盘得到满足。

恶意字面量测试不是装饰。用调用方提供的文本生成脚本源码，正是文档中的一个引号可能变成可执行代码的地方，而 `JSON.stringify` 是把这种可能变为不可能的具体防线。

**运行时不变式：** 不发布伴随插件，因为本包构造脚本文本并运行它，随后返回其输出流，因此唯一的次序就是对同一个运行器的一次调用，而调用方已经会等待它。
