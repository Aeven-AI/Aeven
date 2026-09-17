---
description: "面向 ctx.media 的 pi-ai 图片 provider：部署方如何通过 pi-ai 自身的传输层触达 OpenRouter 的图片目录，凭据、请求转换与失败映射由本包拥有。"
kind: "package-reference"
---

# @aeven/media-pi-ai

[English](README.md) | 中文

## 概述

`avn-media-pi-ai` 把 pi-ai 的 images 注册表注册为 `ctx.media` 的图片后端，因此已经在聊天上信任 pi-ai 的部署可以用同样的方式触达它的图片目录。pi-ai 拥有传输层与模型元数据——在所固定的版本上是 45 个 OpenRouter 图片模型，含 FLUX.2 与 Seedream 系列——而本包拥有凭据解析、把 seam 的请求转换为 pi-ai 的输入内容，以及把 pi-ai 的带内失败转为 `MediaError`。当部署希望无需手写客户端即可使用 OpenRouter 图片时挂载它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与推迟事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在已经加载 `avn-media` 的组合中挂载本 provider；它默认以 `openrouter` 作为图片 provider 注册，因此当它是唯一可用的图片后端时 `ctx.media.generateImage()` 会自动解析到它——也可以在请求中指名。

### 最小配置

`id` 是注册键，`apiKeyEnv` 是凭据引用；两者都有默认值，因此单 provider 部署无需任何配置。挂载了 `ctx.credentials` 服务时凭据经由它解析，否则回退到同名环境变量。

### 请求

seam 的提示词成为 pi-ai 的首条文本内容，每张参考图按给定顺序以内联 base64 紧随其后，这正是图生图模型读取参考的方式。模型 id 原样传递：本 provider 只校验 pi-ai 的目录是否认识它，并在花费调用之前拒绝未知 id。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 通过 provider 对象调用

pi-ai 从其 images 注册表导出 `generateImages`，但该模块不在包的 export map 中。`openrouterImagesProvider()` 返回的 provider 对象自带 `generateImages`，因此本包经由它调用——这也让模型、鉴权与传输由同一个对象解析，而不是三个可能彼此漂移的导入。

### 失败在结果里，而非抛出

pi-ai 通过返回带 `error` 停止原因的结果来报告失败，而不是抛出。本包把它转换为 `MediaError`，使调用方绝不会收到空的成功；对只携带文本的已停止结果也一视同仁：从 seam 的角度看，模型拒绝作画是上游失败，而不是零张图片。

### 源码导航

- `src/index.ts`——配置、凭据解析、请求与结果转换、注册。

<a id="model-experience"></a>
## 模型体验

间接体现，通过挂载媒体 seam 的消费方；本 provider 不注册工具，也不贡献提示词。

#### KV 缓存影响

无直接失效；请求前缀的任何变化由消费方拥有。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本 provider 不适用的场景，均为当前包约束。

- **无 invariant 伴随模块**——不发布运行时 invariant 伴随模块，因为本包不拥有任何两个独立观察者可能产生分歧的关系；它唯一的注册随调用方 fiber 释放，并由本包测试覆盖。
- **仅图片**——pi-ai 完全没有为视频建模，因此需要视频的部署应挂载直接对接视频 API 的 provider。
- **目录固定于 pi-ai 的快照**——模型列表随本工作区解析到的 pi-ai 版本一同交付，因此 OpenRouter 后来新增的模型在升级 pi-ai 之前都是未知的，会被当作未提供的模型拒绝而不是尝试调用。
- **不转发 `n`、`aspectRatio`、`resolution`、`size` 与 `seed`**——pi-ai 的 images 上下文只承载提示词与参考图。需要这些控制项的部署应使用 OpenRouter 的专用图片端点，而非 pi-ai 采用的 chat-modality 路径。
- **无成本或用量报告**——pi-ai 在结果上返回用量，但 seam 没有承载它的位置，因此被丢弃。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文：尚未决定的方向与开放问题。它明确不具权威性——已交付的行为、限制与理由位于上文各节。

#### 未来：专用图片端点

pi-ai 通过带图片 modality 的 chat completions 驱动图片生成，而 OpenRouter 现已提供带 `n`、`resolution`、`aspect_ratio` 与参考控制项的专用图片 API。这些控制项是通过升级 pi-ai 获得，还是由本包自行调用该端点、把 pi-ai 留给它独有覆盖的模型，尚未决定。

</details>
