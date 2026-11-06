---
description: "ctx.motion Service Definition：唯一注册的渲染器把 HTML 动画合成渲染为 MP4 影片。"
kind: "package-reference"
---

# @aeven/motion

[English](README.md) | 中文

## 概述

该 Service Definition 通过 `ctx.motion` 把编写好的动画合成渲染为 H.264 MP4。消费方先把请求（合成文件夹、输出路径，以及可选的帧率、质量与静帧数量）解析为 spec，再在唯一注册的渲染器上渲染该 spec，并得到影片的路径、大小、时长、尺寸、编码器，以及请求的 PNG 静帧。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将它与一个渲染器（如 [`avn-motion-hyperframes`](../motion-hyperframes/README.zh.md)）以及一个消费方（如 [`avn-tool-motion`](../tool-motion/README.zh.md)）一起挂载。`fps`（24、30 或 60；默认 30）与 `quality`（`draft`、`standard` 或 `high`；默认 `standard`）用于补全省略它们的请求。合成路径与输出路径都是本地绝对路径；把它们限制在工作区内是消费方的职责。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`resolve()` 应用默认值并捕获已注册的渲染器；没有注册渲染器时会抛错。`render()` 会拒绝其渲染器已被撤回或替换的 spec，并同时在调用方的信号与注册的生命周期下运行。第二次 `register()` 会抛错，且不替换第一个。注册的释放函数会中止已接受的渲染并等待它们结束。

-----

<a id="model-experience"></a>
## 模型体验

不直接影响。该服务不注册工具，也不向请求添加任何内容；模型看到的一切由 [`avn-tool-motion`](../tool-motion/README.zh.md) 负责。

#### KV Cache 影响

无。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **无不变量伴随包** — 该服务只持有一项注册，没有其他观察者能够与之矛盾的状态。
- **仅限本地路径** — 渲染器从 Host 自身的文件系统读取合成并写出影片，因此工作区位于远程沙箱中的会话无法渲染。

<a id="dev-note"></a>
### 开发备注

无。
