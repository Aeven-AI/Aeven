---
description: "面向 ctx.media 的 OpenRouter 视频 provider：在单一固定 origin 上提交、轮询并取回视频任务，把 OpenRouter 文档化的任务状态映射到 seam 的联合类型。"
kind: "package-reference"
---

# @aeven/media-openrouter

[English](README.md) | 中文

## 概述

`avn-media-openrouter` 把 OpenRouter 的视频 API 注册为 `ctx.media` 的视频后端：提交任务、轮询任务、取回字节。撰写本文时 OpenRouter 中介了 28 个视频模型——Wan、Seedance、Hailuo 与 FLUX 视频系列——并且它是所调研 provider 中唯一枚举了自身任务状态的，这正是 seam 的状态联合类型沿用其词汇、而本适配器直接映射到它的原因。当部署希望通过 OpenRouter 账号生成视频时挂载它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与推迟事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在已经加载 `avn-media` 的组合中挂载本 provider；它默认以 `openrouter` 作为视频 provider 注册。调用方用 `ctx.media.startVideo()` 启动任务，按自己的节奏轮询 `ctx.media.videoStatus()`，待任务报告 `succeeded` 后用 `ctx.media.fetchVideo()` 取回片段。

### 最小配置

`id` 是注册键，`apiKeyEnv` 是凭据引用，`maxVideoBytes` 限制单个取回片段的大小；三者都有默认值。挂载了 `ctx.credentials` 服务时凭据经由它解析，否则回退到同名环境变量。

### 图像

`generateImage` 提交到专用的 `/api/v1/images` 路由，而不是 chat completions。这个选择很关键：OpenRouter 的新图像模型只加在该专用路由上，而其 chat 路由会在工具兼容性路由步骤上拒绝这些模型，因此经 chat completions 触达它们的 harness 会收到一个指明工具支持的 HTTP 404。`n`、`aspectRatio`、`resolution`、`size` 与 `seed` 按该路由自己的字段名转发，参考图以 `input_references` data URI 形式随行。

返回的图像是 `data[].b64_json` 中的 base64。该路由仅在能够识别格式时才报告 `media_type`，因此没有该字段的条目按其自身签名标注；不含编码图像的行会被跳过，而完全没有产出图像的响应是错误，而不是空的成功。

### 请求

`duration`、`aspectRatio`、`resolution`、`size`、`seed` 与 `generateAudio` 转发到该路由自身的字段名，参考图以 `input_references` 的 data URI 形式随行——因此图生视频与参考引导生成都通过同一次调用完成。只发送调用方设置过的字段，其余一律采用模型自身的默认值。

本包的图片提供方拒绝 `guidanceScale`、`outputFormat` 与 `optimizePromptMode`；这些原生 Seedream 控制项由 Aeven 和 DeepInfra 提供方服务。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 状态映射

`pending` 与 `in_progress` 都表示"继续轮询"，因此都变为 `running`。`cancelled` 与 `expired` 变为 `failed` 而非第四种 seam 状态，因为调用方对它们的下一步动作与对 `failed` 完全相同。无法识别的状态让任务保持 `running`：OpenRouter 可能新增一种，持续轮询的调用方能够恢复，而被告知 `failed` 的调用方不能。

### 取回字节

`fetchVideo` 读取该路由自身的内容端点（它代理原始字节），而不是任务体携带的任何 URL。这把出口保持在这一个 origin 上，而不是跟随实际服务该模型的上游厂商。片段被两次限制大小——一次针对声明的 `Content-Length`，一次针对实际收到的字节——因为 provider 可能少报。

### 源码导航

- `src/index.ts`——配置、凭据解析、状态表与三个任务操作。

<a id="model-experience"></a>
## 模型体验

间接体现，通过挂载媒体 seam 的消费方；本 provider 不注册工具，也不贡献提示词。

#### KV 缓存影响

无直接失效；请求前缀的任何变化由消费方拥有。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本 provider 不适用的场景，均为当前包约束。

- **无 invariant 伴随模块**——不发布运行时 invariant 伴随模块，因为本包不拥有任何两个独立观察者可能产生分歧的关系；它唯一的注册随调用方 fiber 释放，并由本包测试覆盖。
- **两个包都能提供 OpenRouter 图像**——`avn-media-pi-ai` 经 pi-ai 的 chat-modality 传输触达同一个账号，且以相同的默认 id 注册，因此同时挂载两者的组合必须给其中之一换一个 `id`。本包的专用路由才是接收新图像模型的那个。
- **不支持流式**——图像路由接受 `stream` 以增量投递，本 Provider 不请求它；一次调用在所有图像就绪时一次性返回。
- **不转发 `quality`、`output_format`、`background` 与 `output_compression`**——Seam 没有承载它们的字段，因此沿用模型自身的默认值。何况请求 SVG 会产生第一版附件路径无法存储的字节。
- **无模型目录**——模型 id 原样传递，由 OpenRouter 而非本包校验，因此无效 id 会在上游失败而不是在调用之前。
- **不支持 webhook**——该路由接受用于完成通知的 `callback_url`，本 provider 不转发它；轮询是唯一的完成路径。
- **无成本报告**——提交响应携带用量估算，seam 没有位置承载它，因此被丢弃。
- **上游错误文本原样透出**——失败消息按 OpenRouter 所写的原样呈现，因此把 provider 文本视为不可信的部署应在消费方处做净化。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文：尚未决定的方向与开放问题。它明确不具权威性——已交付的行为、限制与理由位于上文各节。

#### 退役 pi-ai 图像路径

专用路由已在本包实现后，`avn-media-pi-ai` 就成了以同一种类触达同一账号的第二条路，走的是 OpenRouter 视为遗留的传输层，且面对的是冻结在已安装 pi-ai 中的模型列表。该包是否还有存在理由尚待决定；将其退役会消除上文限制中提到的 id 冲突。

</details>
