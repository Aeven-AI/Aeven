---
description: "面向 ctx.media 的 DeepInfra 图片与视频 provider：在单一固定 origin 上进行 OpenAI 兼容的图片生成与提交／轮询／取回的视频任务，把 DeepInfra 观察到的任务状态映射到 seam 的联合类型。"
kind: "package-reference"
---

# @aeven/media-deepinfra

[English](README.md) | 中文

## 概述

`avn-media-deepinfra` 把 DeepInfra 同时注册为 `ctx.media` 的图片与视频后端。图片走 DeepInfra 的 OpenAI 兼容路由并以 base64 返回；视频是一个任务——提交、轮询、取回——面向同一个账号与 origin。撰写本文时 DeepInfra 中介了 16 个带 `video-gen` 标签的模型，从 Wan、Seedance 到 Veo，按秒计价。当部署希望用一把 DeepInfra 密钥获得两种媒介时挂载它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与推迟事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在已经加载 `avn-media` 的组合中挂载本 provider；它以 `deepinfra` 为两种媒介注册，因此一次挂载即可服务 `ctx.media.generateImage()` 与各视频任务方法。

### 最小配置

`id` 是注册键，`apiKeyEnv` 是凭据引用，`maxVideoBytes` 限制单个取回片段的大小；三者都有默认值。挂载了 `ctx.credentials` 服务时凭据经由它解析，否则回退到同名环境变量。

### 请求

图片请求携带提示词、`n` 与 `size`；该路由文档说明 base64 是它唯一支持的响应格式，因此始终按此请求。视频请求把 `duration` 转发为 `seconds`，另加 `aspectRatio`、`size` 与 `seed`，单张参考图成为用于图生视频的 `image_url` 首帧。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### `queued` 意味着正在运行

DeepInfra 对正在渲染的任务报告 `queued`，且根本不发布任何运行中状态：在 200ms 轮询下观察到的三个任务（包括一个耗时 27.6 秒的 10 秒片段）都直接由 `queued` 转为 `succeeded`。其 OpenAPI 规范把 `status` 标为无枚举的裸字符串，因此本包的状态表记录的是观察结果而非承诺；无法识别的值让任务保持 `running`，而明确的 `error` 字段才是可信的失败信号。

### 图片按其字节标注类型

该路由的 `response_format` 命名的是编码而非图片格式，并且它会以 JPEG 回应一个默认 PNG 的请求。因此本包嗅探每张解码图片的起始字节而非假定类型，并把无法识别的签名保留为 `application/octet-stream` 而不是猜测。

### 取回字节

`fetchVideo` 读取该路由自身的内容端点（它代理原始字节）。任务体的 `data[].url` 指向实际服务该模型的上游厂商——观察到的一个任务指向第三方 CDN——因此针对这些主机的出口白名单将是无界的。通过 DeepInfra 取回可把出口保持在一个可固定的 origin 上。片段被两次限制大小：针对声明的 `Content-Length`，以及针对实际收到的字节。

### 源码导航

- `src/index.ts`——配置、凭据解析、状态表、媒体类型嗅探器与两个 provider。

<a id="model-experience"></a>
## 模型体验

间接体现，通过挂载媒体 seam 的消费方；本 provider 不注册工具，也不贡献提示词。

#### KV 缓存影响

无直接失效；请求前缀的任何变化由消费方拥有。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本 provider 不适用的场景，均为当前包约束。

- **无 invariant 伴随模块**——不发布运行时 invariant 伴随模块，因为本包不拥有任何两个独立观察者可能产生分歧的关系；两个注册都随调用方 fiber 释放，并由本包测试覆盖。
- **状态词汇来自观察而非文档**——DeepInfra 没有枚举任何任务状态，因此记录表之外的值都被当作仍在运行。若它新增一个表示"终结"的状态，任务将被一直轮询到调用方自己的截止时限。
- **无模型目录**——模型 id 原样传递。哪些 DeepInfra 模型生成视频可从其 `video-gen` 标签得知，但本包不读取该列表。
- **不转发 `resolution` 与 `generateAudio`**——视频路由对二者均无文档，因此 seam 的这些字段被丢弃，而不是发送后被忽略。
- **只使用第一张参考图**——该路由只接受一个首帧 `image_url`，因此调用方提供的其余参考图会被静默忽略。
- **不支持 webhook**——对长任务 DeepInfra 推荐用 webhook 替代轮询；本 provider 只轮询。
- **无成本报告**——按秒计价发布在模型列表上而非任务上，且 seam 没有承载它的位置。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文：尚未决定的方向与开放问题。它明确不具权威性——已交付的行为、限制与理由位于上文各节。

#### 未来：旧版 inference 路由

DeepInfra 还提供 `POST /v1/inference/{model}`，它以 `data:` URI 内联返回片段而非返回任务。对轮询开销占主导的短片段它可能更合适，但它复制了一套传输层，并且完全没有状态词汇。未予采用。

</details>
