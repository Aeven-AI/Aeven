---
description: "device 包组：ctx.devices seam、在本机运行模拟器工具链的本地宿主，以及面向模型的设备工具。"
kind: "package-group"
---

# device/ — iOS 模拟器与 Android 模拟器

[English](README.md) | 中文

## 概述

device 组让会话看到并操作 Aeven 所在机器上的 iOS 模拟器与 Android 模拟器，入口是模型的 `device_*` 工具和右侧栏的设备面板。宿主通过 `ctx.devices` 加入，内置组合注册本机作为宿主。用户未在面板中启用设备支持之前，不会安装或启动任何内容；模型控制是另一项独立同意。三个包分担该家族：持有会话与同意的服务、运行工具链的宿主，以及工具。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

seam 包持有设备会话与同意；另外两个包分别提供运行工具链的宿主和模型调用的工具。

| 包 | 职责 |
|---|---|
| [`device/`](device/README.zh.md) | 持有 `ctx.devices`：宿主注册、按会话的设备会话、同意开关，以及设备画面抵达浏览器所经过的已认证 hub 代理 |
| [`device-local/`](device-local/README.zh.md) | 本机宿主：为本地 iOS 模拟器与 Android 模拟器监管 `expo-device-hub` 与 `agent-device` 守护进程 |
| [`tool-device/`](tool-device/README.zh.md) | 面向模型的 `device_list`、`device_open`、`device_screenshot` 与 `device_close` 工具 |

<a id="related-documentation"></a>
## 相关文档

- [设备子系统](../../docs/subsystems/device.zh.md)——`ctx.devices` 的各项操作、设备会话、宿主就绪状态与同意开关。
- [生成的工具目录](../../docs/tool-catalog.zh.md)——模型收到的 `device_*` schema。
- [生成的配置目录](../../docs/config-catalog.zh.md#aevendevice)——该 seam 与本地宿主接受的每个配置字段。
- [能力 seam](../../docs/glossary.zh.md#capability-seam)——本组所依据的 Service Definition、Service Provider 与 Consumer 角色。

<a id="dev-note"></a>

<a id="开发备注"></a>

## 开发备注

无。
