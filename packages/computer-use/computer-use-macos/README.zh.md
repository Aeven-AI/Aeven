---
description: "用于自包含计算机操作的 macOS 桌面适配器：指明授权持有身份的就绪探测、以窗口为作用域的输入，以及文件系统校验。"
kind: "package-reference"
---

# @aeven/computer-use-macos

[English](README.md) | 中文

## 概述

使用操作系统自身的设施为 macOS 实现 [`@aeven/computer-use-desktop`](../computer-use-desktop/README.zh.md) 契约——没有 MCP 服务器、没有第三方服务，也不打包原生代码。

有三项已实现并有测试覆盖。`verify()` 读取真实文件系统，这是工作确实发生的最强且最可移植的证据。`readiness()` 探测辅助功能、屏幕录制与按目标区分的自动化权限，并报告**每项授权由哪个操作系统身份持有**，因为在 macOS 上派生出的辅助进程携带自己的授权，而不是继承 Æven 的授权。输入始终以确切窗口为作用域，因为无作用域的按键可能到达同一进程的兄弟窗口。

观察与辅助功能操作刻意**尚未实现**。它们需要 AX 树遍历器，而该遍历器需要调用进程持有辅助功能授权；派生的辅助进程没有该授权，实测会收到 `-25201 kAXErrorAPIDisabled`。这些路径以 `not-implemented` 拒绝并指出缺失的部分，而不是返回一棵空树——空树与一个没有 UI 的应用程序无法区分。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发者说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

用命令运行器构造适配器，并独立于产生结果的操作去校验结果：

```ts
import { MacDesktopAdapter } from '@aeven/computer-use-macos'

const adapter = new MacDesktopAdapter({ runner, holder: { name: 'osascript', source: 'spawned-helper' } })
const report = await adapter.readiness()
await adapter.act({ kind: 'key', target: { kind: 'window', pid, windowId }, key: 's', modifiers: ['cmd'] })
const [saved] = await adapter.verify([{ kind: 'fileNewerThan', path: output, sinceMs: startedAt }])
if (!saved?.satisfied) throw new Error('the save did not reach disk')
```

## 理解实现

### 就绪状态指明身份，而不只是状态

只报告"辅助功能：已拒绝"并不足以采取行动。每个受权限门控的探测都携带 `grantee`，因此补救说明能够准确指出哪个进程需要该授权——这正是"为 Æven 授权"与让用户在系统设置中反复查找之间的差别。

自动化权限按**每个目标应用程序**探测，因为 macOS 按（控制方，目标）组合授予该权限。适配器把该授权归属于实际持有它的派生辅助进程，而不是 Æven。

### 输入无法在无作用域的情况下发送

`type` 与 `key` 会拒绝未指明窗口的目标。合成的按键跟随焦点，因此未命名的目标正是输入到达错误窗口的途径；实测行为中包括一次后台保存在报告成功的同时没有写入任何内容。

具名按键映射到虚拟键码，因为 `keystroke` 无法表达 Return 之类的按键。无法识别的修饰键会被拒绝而不是被丢弃，因此组合键绝不会静默丢失修饰键。

### 校验从不信任操作本身

`verify()` 从操作系统重新读取可观察对象。无法读取的文件是 `satisfied: false` 并附带原因，绝不会是通过；抛出异常的检查会报告该错误，而不是假设结果良好。

## 延伸阅读

- [`@aeven/computer-use-desktop`](../computer-use-desktop/README.zh.md) —— 本包所实现的契约，以及与之共享的校验器。
- [`@aeven/computer-use-windows`](../computer-use-windows/README.zh.md) —— 同一契约在 Windows 上的实现，那里 UI Automation 无需任何授权。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **观察尚未实现。** 在 AX 树遍历器落地之前，`observe()` 会以 `not-implemented` 拒绝，因此尚无法产生快照或元素令牌。
- **点击、setValue 与 performAction 尚未实现**，原因相同：它们以元素为寻址对象，而这需要快照。
- **AX 遍历需要进程内调用方。** 经由 `osascript` 路由无法工作，因为辅助功能授权属于派生的二进制文件。
- **运行器通过派生子进程执行。** 目前每条命令都作为派生的辅助进程运行，因此携带自己的授权而非 Æven 的授权。把 AX 与输入移入进程内，正是把授权收敛为单一授权的方式。
- **自动化授权提示无法合并。** macOS 按目标应用程序授予 Apple 事件权限，因此每个新脚本化的应用首次都会带来一次确认对话框。

<a id="dev-note"></a>
## 开发者说明

尚未实现的路径是设计的要点，而非疏漏。返回空树的适配器比拒绝的适配器更糟：空树与一个没有辅助功能界面的应用程序无法区分，而在理解这一差别之前，实测代价是二十余次调用。

先构建就绪探测与校验，是因为它们让操作变得可信。两者都完全无需 Mac 即可测试——运行器是注入的，因此每个分支（包括每一种失败模式）都有覆盖。
