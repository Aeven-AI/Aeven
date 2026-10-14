---
description: "iOS 模拟器与 Android 模拟机的接缝：设备宿主、按会话的设备会话、侧栏窗格所渲染的状态流，以及经鉴权的 hub 代理。"
kind: "package-reference"
---

# @aeven/device

[English](README.md) | 中文

## 概述

本服务拥有「哪个会话正在查看哪台模拟器或模拟机」，因此模型的设备工具、右侧栏的 Device 窗格与串流代理读取同一份状态。宿主通过 `ctx.devices` 加入；随附的组合注册的是 Aeven 自身所在的这台机器。在用户在窗格中启用设备支持之前不会安装或启动任何东西，而模型控制还需要另一项独立授权。状态以一个带修订号的快照经 `device` Remote 到达读者，设备画面只有经本服务对宿主 hub 的鉴权代理才能到达浏览器。

## 目录

- [使用本包](#use-this-package)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当宿主需要提供模拟器与模拟机时编排本服务，并为每台运行它们的机器加入一个宿主提供方。它读取 `device` 设置命名空间中的三个授权开关；当 `webServer` 与 `connection` 存在时，它在 `hubMount` 上挂载 hub 代理，使任何浏览器都不直接与 hub 对话。`Config` 提供 `hubMount`、请求／启动／截图截止时间、可选的 `stateDir` 以及授权默认值；`registerHost` 是像 `device-local` 这样的提供方加入的方式，`agentTarget` 则把模型的 agent-device 启动器指向某台设备。

-----

<a id="further-exploration"></a>
## 延伸阅读

当服务契约本身不足以说明问题时阅读这些：本机宿主、渲染该状态的窗格，以及挂载两者的组合。

- [device-local](../device-local/README.zh.md) —— 在本机运行 hub 与 agent 守护进程的宿主。
- [ui-sidebar-device](../../client/ui-sidebar-device/README.zh.md) —— 渲染该状态流的窗格。
- [avn-web-app bundle](../../bundle/web-app/README.zh.md) —— 挂载本行与本机宿主的组合。

-----

<a id="model-experience"></a>
## 模型体验

Indirectly, through avn-tool-device: the model's `device_*` calls invoke this service's device sessions and read the state it publishes, while that package owns the schemas, guidance, and results the model actually reads.

#### KV Cache 影响

无；本包既不组装也不发送 Provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定服务拥有什么、把什么留给宿主。

- **无不变式伴生入口**——不发布不变式伴生入口，因为宿主、其就绪状态、发现的设备与按会话的设备会话的每一次变化都经过同一串行化生命周期与同一个提升修订号的发布点，读者只会经 `device.watch` 收到该快照，因此不存在可供观察者与之比较的第二份副本。
- **授权为整个服务设闸**——设备支持关闭时，读取返回已禁用状态且不启动任何 hub；模型访问关闭时，模型打开的设备的会话无法存在。
- **设备比打开它的会话更长久**——关闭某会话的设备会话只是断开它，只有显式关闭请求才会关闭设备。
- **失败的宿主是状态而非异常**——发现与启动失败连同原因一并写入状态，`retryHost` 是唯一的重试入口。
- **其他账户的会话会被隐去**——调用方会收到本机的设备，但只收到自己的设备会话与启动中的会话。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
