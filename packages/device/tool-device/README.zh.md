---
description: "面向模型的 device_* 工具：会话如何列出、打开、截屏并关闭身旁的 iOS 模拟器与 Android 模拟器。"
kind: "package-reference"
---

# @aeven/tool-device

[English](README.md) | 中文

## 概述

`avn-tool-device` 在 `ctx.tools` 上注册四个工具：`device_list`、`device_open`、`device_screenshot` 与 `device_close`。它们在每次调用时读取 `ctx.devices`，因此本包自身不持有任何设备状态：`device_open` 启动或连接一台设备，为调用它的 Agent 记录该设备，并返回绑定到该设备的 `agent-device` 可执行文件，之后驱动设备的每一步——点击、输入、安装、日志——都通过该 CLI 完成，而不是每个操作一个工具。四个工具在所有宿主机上都注册；缺少 `ctx.devices`、设备支持被关闭，或未开启 Agent 访问时，它们用各自固定的句子作答，而不是隐藏工具。

## 目录

- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

### `device_*` 工具 schema

#### 模型看到的内容

生成的[工具目录](../../../docs/tool-catalog.zh.md#aeventool-device)中的四条条目及其参数。`device_open` 返回打开的设备和 `agent-device` 命令，以及模型用来驱动设备的快速上手文本；`device_screenshot` 返回一行摘要，并在模型所在路由接受图像时附带截取的 PNG。

#### Token 影响

工具可见时固定：四条条目及其描述，与设备或宿主机的数量无关。

#### KV Cache 影响

可见工具集不变时前缀稳定；每次调用追加一条结果。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **驱动设备不是工具** —— 点击、输入、安装与日志都通过 `device_open` 返回的 `agent-device` CLI 完成，因此模型需要一个能够运行它的宿主。
- **无不变式伴生入口** —— 不发布运行时不变式伴生入口，因为每个工具都在调用时读取 `ctx.devices`，本包不持有会话、面板或截屏状态；这些工具所操作的设备记录归 `@aeven/device` 所有。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
