---
description: "面向 Æven 的 macOS 计算机操作提供程序：将适配器、会话、路由与执行器装配为单个插件，并占用独占的注册槽位。"
kind: "package-reference"
---

# @aeven/computer-use-macos-provider

[English](README.md) | 中文

## 概述

macOS 计算机操作中面向组合的一侧。它把适配器、会话、配方路由、执行器与 Apple 事件处理程序装配为一个对象，将其发布到上下文，并经由 [`@aeven/computer-use`](../computer-use/README.zh.md) 占用独占的提供程序槽位。

它的存在，是为了让挂载 macOS 计算机操作成为组合中的一行，而不是让部署方按正确顺序自行装配五个对象。顺序很重要：必须先查询该接缝，**然后**才发布提供程序，因为第二个提供程序必须被拒绝，并在错误中给出已注册者的名称。该接缝返回的 `package` 使整个贡献可逆——卸载插件会再次释放槽位。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
import * as computerUseMacosProvider from '@aeven/computer-use-macos-provider'

// In a composition, as one row:
//   '@aeven/computer-use': {}
//   '@aeven/computer-use-macos-provider': {}
```

插件上声明了 `inject: ['computerUse']`，因此该行会等待注册表，而不是在它先被挂载时失败。正在从 MCP 包装层分阶段迁移的部署可以设置 `register: false`，这样会为就绪状态报告与会话发布提供程序，同时把槽位留给另一个提供程序来驱动。

<a id="understand-the-implementation"></a>
`computer_use_run` 接受 1 到 20 个 `execute`、`observe` 或 `readiness` 步骤。执行步骤指定配方任务、可选的应用 bundle id 和字符串参数；结果包含逐期望校验结果和 `verified`。每次调用拥有一个新会话，并将取消信号传给宿主命令。执行步骤需要写入权限和明确批准；观察和就绪检查不请求执行批准。Web bundle 通过 `register: false` 将语义批次与 Cua Driver 并列挂载；驱动保留独占注册及其无障碍和视觉工具。批量工具不会降级调用那些工具。

## 理解实现

### 由接缝而非服务存储判定重复

提供程序先调用 `ctx.computerUse.register(providerName)`，**然后**才调用 `ctx.provide('computerUseProvider', provider)`。若先发布，Cordis 自身的“服务已注册”错误会抢先触发；它给出槽位名称却不给出归属者，且用的是 Cordis 而非本接缝的措辞。按此顺序调用，可使拒绝信息说明已存在的提供程序是谁。

### 用 `provide` 而非 `set`

属性必须先被声明才能承载值。对未声明的名称调用 `ctx.set` 会抛出错误，而 `ctx.provide` 返回的释放器正是光纤卸载时释放槽位的机制。

### 不占用无法释放的东西

提供程序自身不持有定时器、监听器或进程。它发布的一切都随光纤一同释放，因此停止、更新或取消定义都不会留下半挂载的提供程序。

<a id="further-exploration"></a>
## 进一步探索

- [`@aeven/computer-use`](../computer-use/README.zh.md) —— 本提供程序占用的独占槽位，以及拒绝重复注册的接缝。
- [`@aeven/computer-use-macos`](../computer-use-macos/README.zh.md) —— 提供程序发布的辅助功能与输入适配器。
- [`@aeven/computer-use-macos-apple-events`](../computer-use-macos-apple-events/README.zh.md) —— 语义机制，包含 Keynote 操作。
- [`@aeven/computer-use-executor`](../computer-use-executor/README.zh.md) —— 判定任务是否真正成功的验证。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办工作

- **仅在 macOS 上验证过。** Windows 与 Linux 适配器已存在并有单元测试，但尚无提供程序包挂载它们，两者也都没有在真实主机上运行过。
- **Keynote 是唯一覆盖的演示应用。** 在 macOS 上 `slide.setText` 解析到它，并已实际运行；其余每个 `slide.*` 与 `presentation.*` 任务仍指向 Windows PowerPoint 或 Linux LibreOffice，没有 macOS 行。
- **可以创建演示文稿并设置文本，但不编写版面。** 写入布局占位符可行；新增文本项不可行，因为 Keynote 在幻灯片上拒绝该操作。
- **保存受 Keynote 沙盒限制。** Keynote 只能写入其自身容器，因此演示文稿先保存在那里，随后再移出。要求它写入任意路径会弹出模态对话框并阻塞该应用。
- **默认配方书即起始配方书。** 部署方通过 `recipes` 提供自己的配方。
- **自动化授权按目标应用授予。** 就绪状态报告只探测部署方指定的 bundle id，因为发往某个应用的第一个 Apple 事件会弹出授权对话框。

<a id="dev-note"></a>
## 开发备注

提交前已实际运行 Keynote 路径：创建文档、新增第二张幻灯片、把文本写入布局占位符、保存到 Keynote 自身的容器、通过该应用读回文本，然后重新打开已保存的文件并从磁盘再次读取。非 ASCII 文本——长破折号、带重音字符与中文——原样往返，这正是排除早前语法错误之编码猜想所依据的证据。

该路径上有三处失败是真实存在的，如今已作为测试固化，而不再只是注释。`make new slide` 必须指定文档为目标，因为未指定目标的写法会以 `-10024 Can't make or move that element into that container` 失败。幻灯片拒绝新增文本项，因此文本写入布局提供的占位符。而 `tell application "com.apple.Keynote"` 是语法错误，因为该写法接受的是名称；bundle 标识符需要使用 AppleScript 的 `application id`。

本包的早期版本在声明属性之前调用了 `ctx.set`，表现为 `cannot set property "computerUseProvider" without provide`。注册测试捕获了它，这也正是这些测试断言**消息**而不只是断言抛出的原因。

**运行时不变式：** 不发布伴随插件，因为本包装配其余各包并占用提供程序槽位，它唯一拥有的状态就是随光纤一同释放的那次注册；伴随插件只会复述这段生命周期，而不会检验它。
