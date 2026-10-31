---
description: "面向模型的开关：驱动 Web 朗读器，但自身不发声。"
kind: "package-reference"
---

# @aeven/tool-read-aloud

[English](README.md) | 中文

## 概述

该工具的存在，是为了让 agent 能自行开始朗读自己的回复——促成它的是语言练习这一场景：学习者应当听到每一个回答，而不必每个轮次都点击 composer 的扬声器。开关随调用一起传递，因此可回放：宿主内存中不保留任何状态。

Web 表层观察已结算的 `read_aloud` 调用，并相应地移动自己的朗读开关。因此该工具只通过会话日志与朗读器对话；不实现朗读的表层只是显示工具卡片。

## 目录

- [使用本包](#use-this-package) - [理解实现](#understand-the-implementation) - [模型体验](#model-experience) - [已知限制与延期工作](#known-limitations-and-deferred-work) - [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在宿主组合中把它与其他面向模型的工具一起加载：

```yaml
- id: tool-read-aloud
  name: '@aeven/tool-read-aloud'
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

`execute` 直接返回所请求的开关，不触及任何服务；确认文本由该工具的 `render` 生成。客户端那一半位于 `@aeven/client-ui-tts`，由它把最新的已结算 `read_aloud` 调用应用到自己的引擎。

-----

<a id="dev-note"></a>
## 开发备注

该工具是模型通往朗读器的唯一路径，并且自身不发声：`execute` 回显开关，`render` 写出一行确认文本，Web 表层再依据已结算的调用移动自己的开关。把合成留在宿主之外，意味着无头运行不需要音频设备，回放也不会产生副作用。

卡片标题会说明方向——`Read replies aloud` 或 `Stop reading aloud`——因为对于快速浏览该 transcript（文本记录）的读者来说，仅凭结果行无法看出开关朝哪个方向切换。

不发布运行时 invariant 伴随模块：调用自带取值，因此该工具不持有任何可能被独立观测偏离的状态。

-----

<a id="model-experience"></a>
## 模型体验

### `read_aloud` 工具

#### 模型看到什么

该工具的描述及其唯一的 `enabled` 布尔参数会进入每一个请求；一次调用会向日志追加一条 `tool/call` 与一条 `tool/result`，两者都携带该布尔值。

#### Token 影响

每个请求都有一份固定的 schema 开销，此外每次调用增加一对调用与结果。

#### KV Cache 影响

仅追加：schema 位于稳定的前缀之中，调用在其后追加，因此已有的前缀仍然可复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 开关按会话生效，其存续时间与朗读器的页面状态一样长；没有跨设备的持久偏好。
- 只有 Web 表层会响应。终端客户端能看到工具结果，但不会朗读任何内容。
