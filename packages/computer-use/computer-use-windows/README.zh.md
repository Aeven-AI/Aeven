---
description: "用于自包含计算机操作的 Windows 桌面适配器：无需权限授予的 UI Automation、语义模式操作，以及以窗口为作用域的输入。"
kind: "package-reference"
---

# @aeven/computer-use-windows

[English](README.md) | 中文

## 概述

使用 UI Automation 与 PowerShell 为 Windows 实现 [`@aeven/computer-use-desktop`](../computer-use-desktop/README.zh.md) 契约——没有 MCP 服务器、没有第三方服务，也不打包原生代码。

Windows 是三个平台中权限门控最少的平台，适配器正围绕这一点设计。**UI Automation 无需任何权限授予**，并提供真正的语义模式，因此 `observe()` 直接读取树，`setValue`/`performAction` 通过 `ValuePattern` 之类的模式写入，而不是合成按键。由于模式写入指向其元素而不是跟随焦点，它不可能被投递到错误的窗口——这正是语义路由在这里是默认路径、合成输入只是回退路径的原因。

对于模式无法表达的操作，合成输入仍然可用，并且始终带作用域：每条路径都会先把确切窗口激活到前台，并在激活未发生时如实报告。

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
import { WindowsDesktopAdapter } from '@aeven/computer-use-windows'

const adapter = new WindowsDesktopAdapter({ runner })
const { snapshot } = await adapter.observe({ windowId: '100' })
const body = snapshot.nodes.find(node => node.role.includes('Edit'))
await adapter.act({ kind: 'setValue', target: { kind: 'element', token: body.token }, value: 'the story' })
const [written] = await adapter.verify([{ kind: 'nodeValueEquals', token: body.token, value: 'the story' }])
```

## 理解实现

### 令牌指明其所属窗口

节点令牌的形式是 `<windowId>:<ordinal>`，其中序数是该元素在窗口广度优先遍历中的位置。解析会重放同一遍历，因此令牌不会静默寻址到另一个控件，而格式错误的令牌会在任何 PowerShell 运行之前被拒绝。

由于 UI Automation 枚举的是窗口的子树而不是整个桌面，观察在构造上就带作用域，而不是依赖约定。

### 模式优先于按键

`setValue` 与 `performAction` 以元素为寻址对象，因此不需要焦点，并且可在后台窗口上工作。`performAction` 会拒绝元素未公开的模式，并列出它实际公开的模式，而不是去调用一个名称相近的东西。

### 合成输入始终激活其确切窗口

`type`、`key` 与坐标 `click` 是回退路径。每条路径都会先激活目标窗口，然后**校验它确实来到了前台**，若没有则明确失败——因为合成输入跟随前台，静默失败的激活正是按键到达另一个应用程序的途径。输入文本会被转义，因此被 SendKeys 视为修饰键的 `%`、`+` 等字符会按字面插入。

### 就绪状态说明哪些受门控、哪些不受

报告明确说明 UI Automation 不需要任何授权。无法访问桌面被报告为 `unknown` 而不是 `blocked`，因为原因是不可达的会话，而不是操作者可以去授予的权限。提权被单独探测：未提权的进程可以列出提权应用程序的窗口但无法驱动它，这与缺少授权是不同的问题。

## 延伸阅读

- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.zh.md) —— 本包所实现的契约，包括共享的校验器。
- [`@aeven/computer-use-macos`](../computer-use-macos/README.zh.md) —— 同一契约在 macOS 上的实现，那里辅助功能与自动化权限必须按身份授予。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **尚未在真实 Windows 主机上运行过。** 适配器、其片段以及每一种失败模式都有针对注入运行器的测试覆盖，但没有任何测试驱动过真实桌面；就绪与阻塞的结论需要一台 Windows 主机才能标记为已验证。
- **PowerShell 解析是镜像 `@aeven/pwsh-local` 而非导入它**，因为该包是带有五个 peer 依赖的 Cordis 执行器。候选顺序相同；一旦出现分歧需要手工保持同步。
- **片段每次调用运行一个 PowerShell 进程**，因此在持久 shell 落地之前，批量会话会为每个操作付出进程启动成本。
- **尚无截图捕获。** `observe()` 返回树与窗口边界但不返回像素，因此 Windows 上尚无视觉回退层。
- **数十个进程与很长的树可能较慢。** 节点上限约束了单次遍历，但尚无对连续快照的缓存或差分。

<a id="dev-note"></a>
## 开发者说明

校验器不在此实现：它位于 `@aeven/computer-use-desktop`，因为文件系统检查在每个平台上完全相同，三份副本必然产生偏离。

所有内容都针对注入的命令运行器编写，因此测试套件无需 Windows 机器即可覆盖每一种失败模式——不可达的桌面、无法读取的响应包、失败的模式、格式错误的令牌。
