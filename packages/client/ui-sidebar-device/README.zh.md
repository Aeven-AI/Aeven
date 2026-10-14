---
description: "右侧栏的 Device 内容种类：iOS 模拟器与 Android 模拟器的实时画面，支持触摸、按键、硬件按钮与设备操作。"
kind: "package-reference"
---

# @aeven/client-ui-sidebar-device

[English](README.md) | 中文

## 概述

Device 标签页展示已注册设备宿主上的模拟器与模拟机：先是本机设备列表，随后是已打开设备的实时画面，并附带触摸、键盘输入、硬件按钮、旋转、设置回读，以及该平台支持的操作面板。它通过宿主的鉴权 hub 代理串流，并解码 hub 自身的两种线上格式：浏览器支持 WebCodecs 时使用其解码 H.264，否则使用 hub 的 MJPEG 端点。窗格与模型读取同一份状态：模型打开的设备会出现在打开它的那个会话的窗格中。在用户启用设备支持之前，不会安装或启动任何东西。

## 目录

- [使用本包](#use-this-package)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当 Web 客户端侧栏需要展示设备时编排本插件。它需要 `sidebarContent`、`remote` 与 `remote.device`。`apply` 在插件 fiber 的 effect 中注册 `device` 窗格及其字典，所有窗格共享一条经 `device.watch` 到宿主状态的重连订阅；窗格发送 `device.list`、`device.open`、`device.close`、`device.shutdown`、`device.detail`、`device.action`、`device.configure` 与 `device.retryHost`，而宿主报告某个会话新持有设备时，该会话的 Device 标签页会被打开。

-----

<a id="further-exploration"></a>
## 延伸阅读

当窗格自身契约不足以说明问题时阅读这些：它所呈现的状态，以及它加入的那一栏。

- [device](../../device/device/README.zh.md) —— 负责发现、打开并串流设备的服务。
- [ui-sidebar-select](../ui-sidebar-select/README.zh.md) —— 本窗格注册进入的内容注册表。
- [ui-sidebar-right](../ui-sidebar-right/README.zh.md) —— 渲染会话标签页的那一栏。

-----

<a id="model-experience"></a>
## 模型体验

None, as the pane only renders the device state stream and sends `ctx.devices` commands through the Client Remote; the model's device tools and their results are owned by the tool package that calls the same service.

#### KV Cache 影响

无；本包既不组装也不发送 Provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定窗格展示什么、设备服务拥有什么。

- **无不变式伴生入口**——不发布不变式伴生入口，因为该窗格在插件 fiber 上只拥有一个内容种类注册及其字典，而它呈现的每个值都是设备服务经 `device.watch` 投递的已发布快照，因此客户端不保留第二份可与该状态相互比较的副本。
- **画面与输入是两条独立连接**——串流已建立但触摸与按键尚未到达设备时，窗格会明确说明。
- **设备支持与模型访问是两项独立授权**——支持关闭时窗格提供设置向导；模型访问关闭时，模型打开的设备的会话无法存在。
- **关闭标签页不会关闭设备**——由控制行上的电源操作关闭模拟器或模拟机。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
