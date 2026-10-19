---
description: "面向 ctx.media 的 Aeven 网关图片与视频 provider：通过已登录的 Aeven 会话提供 Aeven-1.0-Image-Flash、Aeven-1.0-Image-Pro、Aeven-1.0-Video-Flash 与 Aeven-1.0-Video-Pro，目录随包内置且始终提供。"
kind: "package-reference"
---

# @aeven/media-aeven

[English](README.md) | 中文

## 概述

`avn-media-aeven` 把 Aeven 自己的网关注册为 `ctx.media` 的图片 provider 与视频 provider。它通过网关的 `POST /v1/images/generations` 提供两个图片模型 `Aeven-1.0-Image-Flash` 与 `Aeven-1.0-Image-Pro`，并以网关任务的形式提供两个视频模型 `Aeven-1.0-Video-Flash`（默认）与 `Aeven-1.0-Video-Pro`：用 `POST /v1/videos` 启动，在 `GET /v1/videos/{id}` 读取。每个请求都以已登录用户的 Aeven 会话作为 bearer，因此生成只需登录，无需厂商密钥。当部署提供 Aeven 的图片或视频模型时挂载它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与推迟事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在已经加载 `avn-media` 的组合中挂载本 provider。它以 `aeven` 注册。

### 最小配置

```yaml
- name: '@aeven/media-aeven'
  config:
    apiUrl: http://localhost:9000   # Aeven API origin; /v1/images/generations is appended
    apiKeyEnv: AEVEN_TOKEN          # credential holding the signed-in session
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `id` | `aeven` | `ctx.media` 下的注册键 |
| `apiUrl` | `http://localhost:9000` | Aeven API origin；与 `llm-aeven` 配置的 origin 相同 |
| `apiKeyEnv` | `AEVEN_TOKEN` | 持有已登录会话的凭据引用，先经凭据 seam 解析，再回退到环境 |
| `maxVideoBytes` | 52428800（50 MiB） | 一次下载接受的最大成片字节数 |

### 模型及其选项

| 选项 | `Aeven-1.0-Image-Flash`（默认） | `Aeven-1.0-Image-Pro` |
|---|---|---|
| `size` | `1K`、`2K`（默认）或 `WIDTHxHEIGHT`（按最接近的宽高比发送，长边最多 2048） | `1K`、`1.5K`、`2K`（默认）或 `WIDTHxHEIGHT` |
| `n` | 1–4 | 1–4 |
| 参考图 | 最多 14 张 | 最多 4 张 |
| `background` | 无 | `transparent` 或 `opaque` |
| `seed` | 0 至 4294967295；不保证可复现 | 无 |
| `guidance_scale` | 无 | 无 |
| `output_format` | 无 | `png` 或 `jpeg` |
| `optimize_prompt_mode` | 无 | `standard` 或 `fast` |

Pro 的透明背景需要恰好一张带 alpha 通道的参考图；该规则由网关执行。

### 请求

`requestBody` 在发出任何请求之前拒绝：Aeven 不提供的模型、在没有该选项的模型上指定背景、超出 1–4 的 `n`、超出模型上限的参考图，以及 `aspectRatio`。每个模型的 `description` 在其各项选项之间写明自身的 `n` 范围，因此工具为模型发布的文本就携带了单次调用可请求的数量。`resolution` 映射为 `size`，不能与显式尺寸同时提供；`seed`、`guidanceScale`、`outputFormat` 与 `optimizePromptMode` 映射为网关对应的蛇形命名字段；对没有引导选项的模型，不发送 `guidanceScale`。其余一切——尺寸词汇、透明背景的 alpha 要求、账号的套餐与余额——由网关负责拒绝，其消息会携带在 `MediaError` 中。参考图以内联 `data:` URL 发送，因为网关不会抓取远程地址。

### 视频

| 选项 | `Aeven-1.0-Video-Flash`（默认） | `Aeven-1.0-Video-Pro` |
|---|---|---|
| 定位 | 快速、经济 | 更慢、更贵，画质更好 |
| `duration` | 仅 8（默认） | 仅 8（默认） |
| `resolution` | `720p` 或 `1080p`（默认） | `720p` 或 `1080p`（默认） |
| `aspectRatio` | `16:9`（默认）或 `9:16` | `16:9`（默认）或 `9:16` |
| 起始图片 | 一张；不支持尾帧 | 一张；不支持尾帧 |
| `seed` | 0 至 4294967295 | 0 至 4294967295 |

`videoRequestBody` 在任务启动之前拒绝：Aeven 不提供的模型、`size`、上表中该模型一栏未列出的 `duration`、分辨率或宽高比，以及超过一张的参考图。起始图片作为 `first_frame_image` 发送，以内联 `data:` URL 传递；`seed` 与 `generateAudio` 映射为 `seed` 与 `generate_audio`。任务以 `Prefer: respond-async` 启动，因此渲染由网关持有，连接中断既不会丢失也不会重复计费。其 `in_progress`、`completed`、`failed` 状态映射为 seam 的 `running`、`succeeded`、`failed`。`fetchVideo` 读取已完成的任务，并从其结果中取得视频：结果带有 `b64_json` 时直接使用这些字节（视频上游的链接未预签名，所以由网关用自己的密钥下载），否则下载其指明的 HTTPS URL，且不携带凭据。两种情况下，超过 `maxVideoBytes` 的一律拒绝。

### 以登录代替持有密钥

bearer 按每次生成解析：先取凭据 seam 中属于发起生成的 Session 所有者的值，否则取当前调用方的值，再否则取启动环境。登录到不同账号的多个客户端共享一个 Host，因此一次生成绝不会出示其他用户的会话。任何地方都没有会话时，调用以 `MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE` 失败，并指明补救办法——登录。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 目录随包内置

`AEVEN_IMAGE_MODELS` 与 `AEVEN_VIDEO_MODELS` 随包内置，而非从网关的 `GET /v1/models` 获取。该列表按权益限定——它回答的是某个账号的套餐可以使用什么——不适合作为每个账号都读取的菜单的输入。两个 provider 的 `available()` 都始终为真，因此每个模型始终列出；缺少登录或账号无权使用该模型，由生成本身报告。

这些条目镜像网关的目录（Aeven API 中的 `services/inference/modelCatalog.js`），其 `GET /v1/models` 在 `image` 与 `video` 下列出同样的逐模型词汇。网关仍是权威：本列表只会提前拒绝它自己声明的内容。

### 源码地图

- `src/index.ts` — 配置、内置目录、请求转换与提前拒绝、网关错误映射、响应与任务解码、成片下载，以及两个 provider 的注册。

<a id="model-experience"></a>
## 模型体验

间接体现，经由挂载媒体 seam 的消费方；本 provider 不注册任何工具，也不贡献任何提示词。

#### KV Cache 影响

没有直接失效；任何请求前缀变化由消费方负责。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本 provider 何时不适用。它们是当前的包约束。

- **没有 invariant 配套** — 不发布运行时 invariant 配套，因为本包不拥有两个独立观察者可能产生分歧的关系；它的两个注册随调用 fiber 一同释放，并由本包测试覆盖。
- **目录是一个镜像** — 网关新增的模型在本列表随包发布之前不会被提供；网关更改的选项在本列表跟进之前会在此被提前拒绝。
- **视频参考仅限首尾帧** — 一张本地图片可作为成片的首帧；网关的 `reference_images`、`reference_videos`、`reference_audios` 只接受 HTTPS 或 `asset://` URL，而本地文件没有这样的地址。
- **费用以网关数字为准** — 图片结果或成功视频任务上的 `costUsdMicros` 是网关账本记录的客户扣费（`usage.cost_usd_micros`）；不报告它的网关会让该字段缺省。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

本开发备注是面向维护者的工作上下文：未决问题与尚未确定的方向。它明确不具权威性——已交付的行为、限制与理由见上文各节。

#### 依据列表扩充

网关的 `GET /v1/models` 现在列出每个图片模型完整的选项词汇。用该列表新增的内容扩充内置目录、但从不缩小它，可以让新模型无需发版即可出现。在两个模型即是全部产品集的情况下暂不推进。

</details>
