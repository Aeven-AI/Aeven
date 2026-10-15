---
description: "Æven 的 Windows 计算机使用提供程序：把适配器、会话、路由器、执行器与 COM 处理器作为一个插件挂载，并占用独占注册位。"
kind: "package-reference"
---

# @aeven/computer-use-windows-provider

[English](README.md) | 中文

## 概述

Windows 计算机使用中面向组合的那一半。它把适配器、会话、配方路由器、执行器与 COM 处理器组装成一个对象，发布到上下文上，并通过 [`@aeven/computer-use`](../computer-use/README.zh.md) 占用独占的提供程序位。

它存在的意义是：挂载 Windows 计算机使用只需组合中的一行，而不是一个部署必须按正确顺序自行接线的五个对象。顺序很重要：接缝会在提供程序发布**之前**被查询，因为第二个提供程序必须带着已注册者的名称被拒绝。该接缝返回的 `package` 让整个贡献可回退——卸载插件时会再次释放该位。

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
import * as computerUseWindowsProvider from '@aeven/computer-use-windows-provider'

// In a composition, as one row:
//   '@aeven/computer-use': {}
//   '@aeven/computer-use-windows-provider': {}
```

插件上声明了 `inject: ['computerUse']`，因此该行会等待注册表就绪，而不是在被先挂载时失败。运行 Cua Driver MCP 提供程序的部署可以设置 `register: false`，这样会发布本提供程序的会话与批量工具，同时把注册位留给驱动；Web bundle 正是以这种方式挂载该行。

`computer_use_run` 接受 1 到 20 个 `execute`、`observe` 或 `readiness` 步骤。执行步骤指定配方任务、可选的应用自动化标识符与字符串参数；结果包含逐预期校验结果与 `verified`。每次调用都拥有一个新会话，并把取消信号转发给宿主命令。执行步骤需要写入权限与明确批准；观察与就绪检查不请求执行批准。

`powershell` 指定所有宿主命令所用的可执行文件，默认取 `PATH` 上的 `powershell`，它随 Windows 一同提供。部署指定时则使用 PowerShell 7。

## Understand the implementation

### 由接缝决定重复，而不是服务存储

提供程序会**先**调用 `ctx.computerUse.register(providerName)`，**再**调用 `ctx.provide('windowsComputerUseProvider', provider)`。若先发布，Cordis 自身的“service already registered”错误会抢先，它只给出槽位名而不给出占用者，而且用的是 Cordis 的措辞而非本接缝的措辞。按这个顺序调用，拒绝信息就会说明已有哪个提供程序。

### 上下文属性有自己的名字

macOS 提供程序发布的是 `ctx.computerUseProvider`；本提供程序发布 `ctx.windowsComputerUseProvider`。Cordis 通过扩展 `Context` 来声明服务，而同一个属性上两个类型不同的提供程序声明无法共存于同一个程序，因此共用一个名字会让两个平台提供程序在编译期而非运行期互斥。

### 用 `provide`，而不是 `set`

属性必须先被占用才能持有值。对未占用的名字调用 `ctx.set` 会抛出，而 `ctx.provide` 返回的清理器正是 fiber 卸载时用来释放该位的。

### 执行器与会话共用同一套处理器

两者都由同一个 `com` 处理器构造，因为一个在其中一个里能解析、在另一个里却失败的任务，等于是本包凭空造出来的任务。该处理器由适配器所用的同一个运行器构建，因此每条宿主命令都经过同一次 PowerShell 解析。

### 不占用任何无法释放的东西

提供程序自身不拥有计时器、监听器或进程。它发布的一切都会随 fiber 一同清理，因此停止、更新或注销都不会留下半挂载的提供程序。

## Further Exploration

- [`@aeven/computer-use`](../computer-use/README.zh.md) — 本提供程序占用的独占位，以及拒绝重复的接缝。
- [`@aeven/computer-use-windows`](../computer-use-windows/README.zh.md) — 提供程序所发布的 UI Automation 与输入适配器。
- [`@aeven/computer-use-windows-com`](../computer-use-windows-com/README.zh.md) — 批量工具执行时所用的语义机制。
- [`@aeven/computer-use-executor`](../computer-use-executor/README.zh.md) — 判定任务是否真正成功的校验。

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **没有任何 COM 任务在真实主机上运行过。** 适配器与处理器都有单元测试，Office 配方标记为 `documented` 而非 `verified`。驱动真实的 Excel、Word 或 PowerPoint 正是缺失的证据，这也是 Web bundle 以 `register: false` 挂载该行、而不是把它当作唯一提供程序的原因。
- **默认配方书就是起始配方书。** 部署通过 `recipes` 提供自己的配方。
- **尚不存在 Linux 提供程序。** [`@aeven/computer-use-linux`](../computer-use-linux/README.zh.md) 有适配器而没有面向组合的那一半，因此 Linux 主机只能通过 Cua Driver MCP 提供程序使用计算机操作。
- **本包中没有任何东西能在非 Windows 主机上运行。** PowerShell 与 UI Automation 就是其机制，因此批量工具会随该行一起注册，但任务在那里会失败；组合用 `process.platform !== 'win32'` 守卫该行。

<a id="dev-note"></a>
## 开发备注

本提供程序是照着 macOS 那个写的，而不是从零开始，因为两者恰好只在三处不同：接入哪个机制处理器、批量步骤声明哪个平台，以及就绪报告——这里报告的是能力，而不是权限授予。

上下文属性名是唯一一处刻意的分歧。初稿用 Windows 提供程序的类型声明了 `computerUseProvider`：当程序中只有两个包之一时它能编过，而一旦有东西同时导入两者就会立即失败——这种失败会出现在调用方而不是这里，因此改成了这个名字。

**运行时不变式：** 不发布配套不变式，因为该包只是组装其他包并占用提供程序位，它自身拥有的唯一状态就是随 fiber 释放的那次注册；配套不变式只会复述这一生命周期，而不是检验它。
