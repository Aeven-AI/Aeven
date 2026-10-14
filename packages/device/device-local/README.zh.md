---
description: "本机设备宿主：在 Aeven 所运行的机器上为该机的 iOS 模拟器与 Android 模拟机运行 expo-device-hub 与 agent-device。"
kind: "package-reference"
---

# @aeven/device-local

[English](README.md) | 中文

## 概述

这是「Aeven 自身所运行的那台机器」这一设备宿主：它把 expo-device-hub 作为回环子进程监管，应答设备服务调用的 hub JSON 路由，并在用户授予模型访问后启动 agent-device 守护进程。两者都是按需安装到设备工具目录下的固定版本 npm 工具，并用宿主的 Node 运行，而不是依赖会过期的 npx 缓存，因此运行时使用的正是模型指令所描述的版本。平台可用性来自对本机 Xcode 与 Android SDK 的探测，因此没有模拟器工具链的机器不会安装或启动任何东西。

## 目录

- [使用本包](#use-this-package)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在需要访问本机模拟器与模拟机的宿主上，与 `@aeven/device` 一并编排本插件；它注入 `devices`，并以本机宿主 id 注册一个宿主。`Config` 提供固定的 `hubVersion` 与 `agentVersion`、可选的 `toolsDir` 与 `stateDir` 根目录、工具运行与安装所用的 `nodePath` 与 `npmPath`，以及安装、就绪、重启与命令的截止时间。宿主何时启动由服务决定，因此在用户启用设备支持（对 agent 守护进程而言还需模型访问）之前，本包不安装也不启动任何东西。

-----

<a id="further-exploration"></a>
## 延伸阅读

当宿主自身契约不足以说明问题时阅读这些：它加入的服务、展示其串流内容的窗格，以及挂载它的组合。

- [device](../device/README.zh.md) —— 本宿主注册进入的设备接缝。
- [ui-sidebar-device](../../client/ui-sidebar-device/README.zh.md) —— 渲染所串流画面的窗格。
- [avn-web-app bundle](../../bundle/web-app/README.zh.md) —— 挂载本行的组合。

-----

<a id="model-experience"></a>
## 模型体验

None, as the host only installs and starts the tools behind `ctx.devices`; the model's device tools and their results are owned by the tool package that calls that service.

#### KV Cache 影响

无；本包既不组装也不发送 Provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定宿主做什么、拒绝做什么。

- **无不变式伴生入口**——不发布不变式伴生入口，因为宿主只为每个工具持有一个受监管的子进程，并仅通过设备宿主契约报告就绪状态，由设备服务记录并发布；因此本插件不保有任何可供独立观察者与该记录比较的状态。
- **安装按需进行且需要 registry**——首次启用设备支持时从 npm 获取固定的 hub 与 agent 版本；安装失败会作为宿主状态报告，而不是被静默重试。
- **可用性是探测出来的，而非预置的**——缺少 Xcode 或 Android SDK 会把该平台标记为不可用并给出原因，而不是让整个宿主失败。
- **hub 崩溃后会被重启**——服务会报告该重启，因此串流会中断并重连，而不是宿主永久失败。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
