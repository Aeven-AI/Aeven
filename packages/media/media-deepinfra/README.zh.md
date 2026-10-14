---
description: "面向 ctx.media 的 DeepInfra 图片与视频 provider：原生 Seedream 和 OpenAI 兼容图片生成，以及提交／轮询／取回的视频任务，把 DeepInfra 观察到的任务状态映射到 seam 的联合类型。"
kind: "package-reference"
---

# @aeven/media-deepinfra

[English](README.md) | 中文

## 概述

`avn-media-deepinfra` 把 DeepInfra 同时注册为 `ctx.media` 的图片与视频后端。Seedream 图片走原生推理及不带凭据的 Ark CDN 下载；其他图片走 DeepInfra 的 OpenAI 兼容路由并以 base64 返回；视频是一个任务——提交、轮询、取回——面向同一个账号与 origin。撰写本文时 DeepInfra 中介了 16 个带 `video-gen` 标签的模型，从 Wan、Seedance 到 Veo，按秒计价。当部署希望用一把 DeepInfra 密钥获得两种媒介时挂载它。

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

`id` 是注册键，`apiKeyEnv` 是凭据引用，`maxVideoBytes` 限制单个取回片段的大小，`maxImageBytes` 把每张原生图片的下载限制为 32 MiB；所有字段都有默认值。挂载了 `ctx.credentials` 服务时凭据经由它解析，否则回退到同名环境变量。

### 请求

图片模型来自 `GET /models/list` 中未弃用的 `text-to-image` 条目。OpenAI 格式的列表遗漏 Seedream 4.5 和 5.0 Pro。Seedream 4、4.5 和 5.0 Pro 使用 `POST /v1/inference/{model}`；`size` 或 `resolution` 提供模型支持的档位或 `WIDTHxHEIGHT`，`n` 发起相应次数的原生调用。

| 控制项 | Seedream 4 / 4.5 | Seedream 5.0 Pro |
|---|---|---|
| 档位 | 2K（默认）、4K；Seedream 4 支持 1K | 1K、1.5K、2K（默认） |
| 参考图 | 一张 | 最多四张，按顺序 |
| `seed` | −1（随机）至 4294967295；不可复现 | 拒绝 |
| `guidanceScale` | 1–10 | 拒绝 |
| `outputFormat` | 拒绝 | `png` 或 `jpeg` |
| `background` | 拒绝 | `transparent` 或 `opaque` |
| `optimizePromptMode` | 拒绝 | `standard` 或 `fast` |

透明输出需要恰好一张带 alpha 通道的参考图，且不能使用 JPEG。其他图片模型沿用兼容路由的显式像素尺寸、单张参考图、`background` 和 base64 响应。视频请求把 `duration` 转发为 `seconds`，另加 `aspectRatio`、`size` 与 `seed`；第一张参考图提供 `image_url` 首帧。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### `queued` 意味着正在运行

DeepInfra 对正在渲染的任务报告 `queued`，且根本不发布任何运行中状态：在 200ms 轮询下观察到的三个任务（包括一个耗时 27.6 秒的 10 秒片段）都直接由 `queued` 转为 `succeeded`。其 OpenAPI 规范把 `status` 标为无枚举的裸字符串，因此本包的状态表记录的是观察结果而非承诺；无法识别的值让任务保持 `running`，而明确的 `error` 字段才是可信的失败信号。

### 图片按其字节标注类型

该路由的 `response_format` 命名的是编码而非图片格式，并且它会以 JPEG 回应一个默认 PNG 的请求。因此本包嗅探每张解码图片的起始字节而非假定类型，并把无法识别的签名保留为 `application/octet-stream` 而不是猜测。

### 原生图片下载

原生结果指向 Ark 的 `ark-content-generation-v2-ap-southeast-1.tos-ap-southeast-1.volces.com` 或 `ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com` CDN。下载仅接受这些精确主机上的 HTTPS，拒绝重定向，不发送授权标头，并在读取流时执行 `maxImageBytes` 限制。DeepInfra 的 bearer 只发送到 `api.deepinfra.com`；返回图片的字节决定媒体类型和实际尺寸。

### 兼容图片控制项

兼容路由要求显式 `WIDTHxHEIGHT`，并忽略未知字段。对于原生 Seedream 集合之外的模型，拒绝分辨率档位和多张参考图；种子、引导强度、输出格式及提示词优化也在此被拒绝，而非静默忽略。

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

- **种子不等于可复现**——Seedream 4 和 4.5 接受提供方的种子字段；相同种子不保证相同字节。
- **Ark 专有开关不可用**——DeepInfra 不暴露 `watermark`、`sequential_image_generation` 或 `max_images`。`n` 执行独立生成，不会创建原生故事或变体集。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文：尚未决定的方向与开放问题。它明确不具权威性——已交付的行为、限制与理由位于上文各节。

#### 原生视频推理

DeepInfra 的原生路由也以 `data:` URI 内联返回视频。视频 provider 保留提交／轮询／取回路径，其状态及取消方法与媒体 seam 匹配。

</details>
