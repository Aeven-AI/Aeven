---
description: "用于自包含计算机操作的 Linux 桌面适配器：感知合成器的窗口后端、输入阶梯，以及指明缺失项的就绪状态。"
kind: "package-reference"
---

# @aeven/computer-use-linux

[English](README.md) | 中文

## 概述

为 Linux 实现 [`@aeven/computer-use-desktop`](../computer-use-desktop/README.zh.md) 契约——没有 MCP 服务器、没有第三方服务，也不打包二进制文件。它驱动会话本身已有的工具：合成器的控制套接字、X11 实用程序，以及 Wayland 输入工具。

Linux 是能力真正存在差异的平台，因此本适配器围绕**报告而非假定**构建。窗口控制委托给能够应答的后端——先是 Hyprland 的 `hyprctl`，然后是 i3/sway 的 `i3-msg`，最后是经由 `wmctrl` 的通用 EWMH——输入则委托给 `xdotool`、`wtype` 或 `ydotool` 中存在的那个。报告会指明应答的后端，并列出所有尝试过的后端，因为对调用方而言，空窗口列表与缺少后端否则无法区分。

已实现并有测试覆盖：`verify()`、`readiness()`、窗口观察、窗口聚焦，以及文本与按键输入。AT-SPI 树与以元素为寻址对象的操作**尚未实现**，它们以 `not-implemented` 拒绝，而不是返回空树。

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
import { LinuxDesktopAdapter, type LinuxAdapterOptions } from '@aeven/computer-use-linux'

// The command runner is the caller's: this package owns the adapter, not the seam.
declare const runner: LinuxAdapterOptions['runner']

const adapter = new LinuxDesktopAdapter({ runner })
const report = await adapter.readiness()
const { snapshot, notes } = await adapter.observe({})
console.log(notes) // which backend answered, and what is not implemented
await adapter.act({ kind: 'type', target: { kind: 'window', pid: 4711, windowId: 'w1' }, text: 'the story' })
```

<a id="understand-the-implementation"></a>
## 理解实现

### 后端是数据，按顺序尝试

每个窗口后端声明其命令、如何解析该命令自身的输出，以及如何聚焦一个窗口。适配器按顺序尝试并报告胜出者。这使平台的分裂保持可见且可测试，而不是隐藏在一次有时什么都不返回的调用之后。

无法解析的输出算作该后端失败，而不是算作零个窗口：合成器返回了意外内容是另一个问题，与桌面没有窗口不同。

### 就绪状态指明阻塞项

`unknown` 与 `blocked` 刻意区分。缺少 D-Bus 会话总线是会话事实，报告为 `unknown`；缺少 AT-SPI 注册表是 `blocked`，并附上启用它的设置。当没有窗口后端应答时，失败信息会列出所有三个尝试过的后端；当没有输入工具应答时，补救说明在 X11（`xdotool`）与 Wayland（`wtype`，或配合运行中的 `ydotoold` 使用 `ydotool`）之间有所不同。

### 输入始终指明其窗口

文本与按键输入需要窗口目标。适配器先通过某个后端聚焦该窗口，再经由阶梯发送——X11 上用 `xdotool`，然后是 `wtype`，再是 `ydotool`——因此发送失败会被报告为能力失败，而不是静默地发往当前持有焦点的窗口。无法识别的修饰键会被拒绝，绝不会被丢弃。

<a id="further-exploration"></a>
## 延伸阅读

- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.zh.md) —— 本包所实现的契约，包括共享的校验器。
- [`@aeven/computer-use-windows`](../computer-use-windows/README.zh.md) 与 [`@aeven/computer-use-macos`](../computer-use-macos/README.zh.md) —— 同一契约在变量是权限授予而非后端的平台上的实现。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **AT-SPI 树尚未实现。** `observe()` 返回窗口与边界，但不返回辅助功能节点，因此无法产生元素令牌，以元素为寻址对象的操作会拒绝。
- **点击、setValue 与 performAction 尚未实现**，原因相同：它们需要该树或一条指针路径。
- **尚未在真实 Linux 桌面上运行过。** 每个分支与失败模式都有针对注入运行器的覆盖，但没有任何测试驱动过真实会话；就绪状态的结论需要一台 X11 与一台 Wayland 主机才能标记为已验证。
- **缺少 GNOME Shell 扩展后端。** GNOME Wayland 常常拒绝向未受认可客户端提供窗口内省，上游的补救是安装一个本适配器不打包的 Shell 扩展；此类会话会报告 `no-window-backend`。
- **没有截图捕获**，因此视觉回退层不可用。
- **每条命令一个进程**，因此批量会话会为每个操作付出进程启动成本。

<a id="dev-note"></a>

<a id="开发备注"></a>

## 开发备注

拒绝路径与可用路径同样重要。在无法读取树时返回空树的适配器，比直接拒绝的适配器更糟，因为空树与一个不发布辅助功能界面的应用程序无法区分。

阶梯顺序是刻意显式的数据，而不是一连串条件分支，这正是让"将尝试哪个后端、以什么顺序"成为测试可以断言之物的原因。

**运行时不变式：** 不发布伴随插件，因为本包是由调用方驱动的宿主侧适配器，它不在调用之间保留同进程状态，也不发出任何监听器可观察的序列。
