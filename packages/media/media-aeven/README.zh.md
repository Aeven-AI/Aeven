---
description: "面向 ctx.media 的 Aeven 网关图片 provider：通过已登录的 Aeven 会话提供 Aeven-1.0-Image-Flash 与 Aeven-1.0-Image-Pro，目录随包内置且始终提供。"
kind: "package-reference"
---

# @aeven/media-aeven

[English](README.md) | 中文

## 概述

`avn-media-aeven` 把 Aeven 自己的网关注册为 `ctx.media` 的图片 provider。它通过网关的 `POST /v1/images/generations` 提供两个模型 `Aeven-1.0-Image-Flash` 与 `Aeven-1.0-Image-Pro`，并以已登录用户的 Aeven 会话作为 bearer，因此生成图片只需登录，无需厂商密钥。当部署提供 Aeven 的图片模型时挂载它。

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

### 模型及其选项

| 选项 | `Aeven-1.0-Image-Flash`（默认） | `Aeven-1.0-Image-Pro` |
|---|---|---|
| 实际服务 | FLUX.2 [klein] 9B | Seedream 5.0 Pro |
| `size` | `WIDTHxHEIGHT`，每边 128–1920 px；默认 `1024x1024` | `1K`、`1.5K`、`2K`（默认）或 `WIDTHxHEIGHT` |
| `n` | 1–4 | 1–4 |
| 参考图 | 最多 4 张 | 最多 4 张 |
| `background` | 无 | `transparent` 或 `opaque` |

Pro 的透明背景需要恰好一张带 alpha 通道的参考图；该规则由网关执行。

### 请求

`requestBody` 在发出任何请求之前拒绝：Aeven 不提供的模型、在没有该选项的模型上指定背景、超出 1–4 的 `n`、多于四张参考图，以及网关没有对应字段的 seam 字段 `aspectRatio`、`resolution` 与 `seed`。其余一切——尺寸词汇、透明背景的 alpha 要求、账号的套餐与余额——由网关负责拒绝，其消息会携带在 `MediaError` 中。参考图以内联 `data:` URL 发送，因为网关不会抓取远程地址。

### 以登录代替持有密钥

bearer 按每次生成解析：先取凭据 seam 中属于发起生成的 Session 所有者的值，否则取当前调用方的值，再否则取启动环境。登录到不同账号的多个客户端共享一个 Host，因此一次生成绝不会出示其他用户的会话。任何地方都没有会话时，调用以 `MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE` 失败，并指明补救办法——登录。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 目录随包内置

`AEVEN_IMAGE_MODELS` 随包内置，而非从网关的 `GET /v1/models` 获取。该列表按权益限定——它回答的是某个账号的套餐可以使用什么——不适合作为每个账号都读取的菜单的输入。`available()` 始终为真，因此两个模型始终列出；缺少登录或账号无权使用该模型，由生成本身报告。

这些条目镜像网关的目录（Aeven API 中的 `services/inference/modelCatalog.js`），其 `GET /v1/models` 在 `image` 下列出同样的逐模型词汇。网关仍是权威：本列表只会提前拒绝它自己声明的内容。

### 源码地图

- `src/index.ts` — 配置、内置目录、请求转换与提前拒绝、网关错误映射、响应解码，以及 provider 注册。

<a id="model-experience"></a>
## 模型体验

间接体现，经由挂载媒体 seam 的消费方；本 provider 不注册任何工具，也不贡献任何提示词。

#### KV Cache 影响

没有直接失效；任何请求前缀变化由消费方负责。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本 provider 何时不适用。它们是当前的包约束。

- **没有 invariant 配套** — 不发布运行时 invariant 配套，因为本包不拥有两个独立观察者可能产生分歧的关系；它唯一的注册随调用 fiber 一同释放，并由本包测试覆盖。
- **目录是一个镜像** — 网关新增的模型在本列表随包发布之前不会被提供；网关更改的选项在本列表跟进之前会在此被提前拒绝。
- **没有视频** — 网关不提供视频路由。
- **没有费用报告** — 网关在自己的账本上结算每次生成，而 seam 没有地方承载该费用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

本开发备注是面向维护者的工作上下文：未决问题与尚未确定的方向。它明确不具权威性——已交付的行为、限制与理由见上文各节。

#### 依据列表扩充

网关的 `GET /v1/models` 现在列出每个图片模型完整的选项词汇。用该列表新增的内容扩充内置目录、但从不缩小它，可以让新模型无需发版即可出现。在两个模型即是全部产品集的情况下暂不推进。

</details>
