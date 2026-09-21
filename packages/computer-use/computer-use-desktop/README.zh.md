---
description: "面向 macOS、Windows 与 Linux 自包含桌面计算机操作的共享适配器契约。"
kind: "package-reference"
---

# @aeven/computer-use-desktop

[English](README.md) | 中文

## 概述

每个平台适配器都实现同一个小型契约，因此针对该契约编写的配方无需平台分支即可在 macOS、Windows 与 Linux 上运行。契约包含四项操作：观察窗口与辅助功能节点的一致视图、尝试执行一个操作、通过独立回读校验结果，以及报告本机实际可用的能力。

有两条规则属于类型本身，而不是类型之外的说明。`act()` 返回的是所尝试与所观察到内容的回执，无法表达成功，因此需要确定性的调用方必须调用 `verify()`。元素令牌仅在其产生它的快照中有效，因此对过期令牌的操作会以具名错误失败，而不会落到该位置当前所在的其它控件上。

本包不包含任何平台代码。它的存在是为了让三个适配器不会彼此偏离。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发者说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在平台包中实现 `DesktopAdapter`，并把它交给把工作路由到它的消费方：

```ts
import type { DesktopAdapter } from '@aeven/computer-use-desktop'

const result = await adapter.observe({ pid: 42, windowId: 'w1' })
const node = resolveNode(result.snapshot!, result.snapshot!.nodes[0].token)
await adapter.act({ kind: 'click', target: { kind: 'element', token: node.token } })
await assertVerified(await adapter.verify([{ kind: 'fileExists', path: '/tmp/out.pages' }]), 'save document')
```

## 理解实现

### 观察是有作用域的

`observe()` 接收 `ObserveScope`，因此扫描整个桌面绝不会成为意外的默认行为。作用域可以指定进程、窗口，或两者都不指定；树比截图更廉价，因此像素需要显式请求。

### 操作无法声称成功

`ActionReceipt` 记录所使用的路由以及适配器能观察到的内容。它没有成功字段。调用方通过以能够独立重读的期望（例如文件内容或元素值）调用 `verify()` 来确认工作确实发生。

这种形态的存在，是因为操作回执在实践中并不可靠：驱动可能报告已投递按键，而目标文件从未改变。

### 令牌以快照为作用域

`resolveNode()` 会以 `stale-token` 码拒绝来自其它快照的令牌，`assertAdvertisedAction()` 会拒绝节点未公开的辅助功能操作。两种失败都会指出违规的令牌，因此调用方可以报告真实原因，而不是泛化错误。

### 能力是被报告的，而不是被假定的

`ReadinessReport` 为每项能力携带一个探测结果，状态为 `ready`、`blocked` 或 `unknown`，并附带每项授权所属的操作系统身份。`unknown` 与 `blocked` 刻意区分：未能运行的探测并不等于缺少权限。`composeReadinessReport()` 从探测结果推导阻塞项列表，因此报告不会自相矛盾。

## 延伸阅读

- [`@aeven/computer-use`](../computer-use/README.zh.md) —— 部署中独占的提供方注册。
- [计算机操作子系统](../../../docs/subsystems/computer-use.zh.md) —— 本契约所服务的参考会话模型。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **尚未提供服务注册。** 本包定义契约及其防护。把提供方接入 `ctx.computerUse` 并提供面向模型的会话，将随平台适配器一同到来。
- **没有平台实现。** macOS、Windows 与 Linux 适配器是独立的包；本包自身无法观察或执行任何操作。
- **不保证能力对等。** Linux 无法在每个桌面上都承诺窗口后端，因此调用方必须查阅 `readiness()`，而不能假定某项操作可用。

<a id="dev-note"></a>
## 开发者说明

契约刻意在任何地方都没有"是否成功"的返回值。本包所防护的每一种失败模式都在实践中被观察到：无作用域的输入到达了错误的窗口、过期的元素索引解析到了另一个控件、以及操作声称已投递而可观察对象从未改变。

类型模块不包含运行时代码，因此依赖该契约没有成本；`guard.ts` 与 `verify.ts` 保存运行时校验，并有各自的测试套件覆盖。
