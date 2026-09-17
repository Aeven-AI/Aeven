---
description: "ctx.media 之上的 generate_image 工具：解析请求、经选定 Provider 生成、并把字节存为会话内的持久附件，只此一个面向模型的接触面。"
kind: "package-reference"
---

# @aeven/tool-media

[English](README.md) | 中文

## 概述

`avn-tool-media` 发布 `generate_image`，即生成式媒体 Seam 面向模型的接触面。它解析一次调用的模型与 Provider，经 `ctx.media` 生成，再用 `ctx.attachments` 存下每张返回的图像，因此结果携带的是持久图像块，而不是文件或 URL。请在已加载 `avn-media` 且至少有一个图像 Provider 的组合中挂载它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与推迟事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

请与 `avn-media` 及一个或多个图像 Provider 一起挂载。`model` 指定调用未给出模型时所用的模型，按 Provider 自己的写法原样传递；`provider` 固定由哪个已注册 Provider 服务这些调用。两者默认都不设置，即交由 Seam 自行选择，并要求每次调用自己指明模型。

挂载两个图像 Provider 的部署需要固定其一，或在此处、或作为 Seam 的 `imageProvider`：选择存在歧义时，Seam 会报错而不是猜测。

### 请求

`prompt` 是唯一必填参数。`model` 与 `provider` 为单次调用覆盖本部署的默认值，这正是同一个已挂载工具触达两个模型写法不同的 Provider 的方式。`n`、`aspect_ratio`、`resolution`、`size` 与 `seed` 按 Seam 自己的字段名转发；只发送调用实际设置的字段，其余沿用各 Provider 自身的默认值。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`resolveRequest` 把默认值填充做成一个显式步骤，因此既未指明模型、也没有配置默认值的调用会按名报错，而不是以空 id 抵达某个 Provider。

`storable` 把生成的媒体类型收窄到第一版附件路径能存储的四种位图格式。Provider 可能返回别的东西——OpenRouter 按请求提供 SVG，签名无法识别的字节会被标为 `application/octet-stream`——这些在此处连同类型名一起被拒绝，而不是在存储层变成一句无信息的拒绝。

`imageBlockRef` 恢复输出 Schema 压平成字符串的 `AttachmentId` 品牌类型。字节由本工具经 `saveImage` 存入，因此该品牌成立，无需二次读取存储。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 Schema

#### 模型看到什么

模型看到生成的 [`generate_image` Schema](../../../docs/tool-catalog.zh.md#aeventool-media)：一个必填的 `prompt` 和七个可选控制项——用于单次调用覆盖的 `model` 与 `provider`，以及转发给 Seam 的 `n`、`aspect_ratio`、`resolution`、`size`、`seed`。描述写明了一个好的 prompt 应涵盖什么，并告诉模型不要再调用其他工具去定位或校验图像，因为附件本身就是结果。

#### Token 影响

在工具可见的每次请求上都是固定的 Schema 开销。对给定配置而言，描述与 Schema 是稳定的；配置的默认模型不出现在两者中。

#### KV 缓存影响

只要定义与可见性不变，前缀保持稳定。插件生命周期或作用域限制可能使基于该 Schema 的复用失效。

### 工具调用历史与结果

#### 模型看到什么

成功返回一行——`Generated <n> image(s) with <model> via <provider>.`——其后是每张已存图像对应的一个图像块。失败则呈现 Seam 自己的消息，其中写明失败条件：未指明模型、Provider 选择存在歧义、上游 HTTP 状态，或无法存储的媒体类型。

#### Token 影响

每张返回的图像会在其后仍然携带它的每次请求中占用视觉 Token，这远大于它旁边那行文本。一次调用生成多张图像会在会话余下部分成倍放大该开销，直到压缩或请求图像卸载将它们替换。

#### KV 缓存影响

仅追加；新可见内容位于可复用的请求前缀之后，不会使已有的 KV 缓存条目失效。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本包不适用的场景，均为当前的包级约束。

- **不发布配套 invariant**——本工具不拥有持久状态，也不拥有可独立观测的关系：Provider 选择归 Seam，存储归 `ctx.attachments`（它校验自己的摘要），而已存引用只经写入它的那个存储读回。
- **不支持参考图**——Seam 为图生图携带了 `references`，两个已挂载的 Provider 也都接受，但本工具没有图像参数，因此无法经由它编辑已有图像。
- **不支持视频**——Seam 把视频建模为带自身轮询与取回调用的任务，这需要独立的工具接触面，而不是本工具上的一个参数。
- **跨 Provider 只有一个默认模型**——配置的默认值是单个字符串，因此既未固定 Provider、又挂载了两个模型写法不同的 Provider 的部署，需要每次调用同时指明两者。
- **不报告成本**——Provider 会报告每次生成的成本，而 Seam 没有承载它的地方，因此它不会抵达结果。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文：开放问题与未定方向。它明确不具权威性——已交付的行为、限制与理由见上文各节。

#### 暴露参考图

增加图像参数会让编辑变得可达，但那样一来本工具就需要把附件从存储中读回，才能把参考字节交给 Provider，而这将是本包第一次读取而非写入。尚未决定。

</details>
