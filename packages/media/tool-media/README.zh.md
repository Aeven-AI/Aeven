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

`choices` 是可选模型的完整集合，每项都指明自己的 Provider。它非空时，选择器、`/image-models` 命令以及调用指明的模型都限于该列表，因此列表之外的模型会在任何生成之前被拒绝。内置 Preset 列出 `Aeven-1.0-Image-Flash` 与 `Aeven-1.0-Image-Pro`，默认 Flash，并设置 `confirmModel: false`，因此首次生成不经询问直接使用 Flash，`/image-models` 用于更改已存储的选择。

`listedProviders` 指定一些媒体 Provider，它们自己的图像模型列表会排在 `choices` 之后提供。该列表在每次调用时读取，因此选择器、`/image-models` 与调用校验会跟随在运行时变化模型的 Provider。内置 Preset 指定 `grok-subscription` 与 `codex-subscription`，它们的图像模型在订阅已登录、且该模型在 设置 → 提供方 中开启时被列出。

挂载两个图像 Provider 的部署需要固定其一，或在此处、或作为 Seam 的 `imageProvider`：选择存在歧义时，Seam 会报错而不是猜测。

### 请求

`prompt` 是唯一必填参数。`model` 为单次调用覆盖所选模型，并由其 choice 指明的 Provider 服务。`n`、`size` 与 `background` 按 Seam 自己的字段名转发；只发送调用实际设置的字段，其余沿用 Provider 自身的默认值，Provider 会拒绝所选模型没有的选项。`reference_images` 按 prompt 引用的顺序列出图像文件；每个文件在会话工作目录下经由 `ctx.fs` 读取，受 `maxReferenceImageBytes`（默认 4 MiB）限制，按其字节识别格式，并作为参考图发送给 Provider。对话中的图像通过其句柄文本显示的规范化副本路径传入。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`resolveRequest` 把默认值填充做成一个显式步骤，因此既未指明模型、也没有配置默认值的调用会按名报错，而不是以空 id 抵达某个 Provider。`choices` 限制也在这里执行，因为无论选择器做了什么，每次生成都要经过它。

`readReferences` 经由已挂载的文件系统后端读取参考图，因此工作区文件与对话图像的规范化副本以同样方式读取。在未挂载文件系统时指明参考图的调用会按名报错。

`storable` 把生成的媒体类型收窄到第一版附件路径能存储的四种位图格式。Provider 可能返回别的东西——OpenRouter 按请求提供 SVG，签名无法识别的字节会被标为 `application/octet-stream`——这些在此处连同类型名一起被拒绝，而不是在存储层变成一句无信息的拒绝。

`imageBlockRef` 恢复输出 Schema 压平成字符串的 `AttachmentId` 品牌类型。字节由本工具经 `saveImage` 存入，因此该品牌成立，无需二次读取存储。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 Schema

#### 模型看到什么

模型看到生成的 [`generate_image` Schema](../../../docs/tool-catalog.zh.md#aeventool-media)：一个必填的 `prompt` 和五个可选控制项——用于单次调用覆盖的 `model`，转发给 Seam 的 `n`、`size` 与 `background`，以及用于编辑或基于现有图像绘制的 `reference_images`。描述写明了一个好的 prompt 应涵盖什么、如何传入参考图，以及每个已配置的 choice 及其描述和默认项，使模型知道哪个模型具备哪个选项；它还告诉模型不要再调用其他工具去定位或校验图像，因为附件本身就是结果。

#### Token 影响

在工具可见的每次请求上都是固定的 Schema 开销。对给定的组合配置而言，描述与 Schema 是稳定的；描述列出的是组合的 choices 与默认项，而不是用户之后存储的选择。

#### KV 缓存影响

只要定义与可见性不变，前缀保持稳定。插件生命周期或作用域限制可能使基于该 Schema 的复用失效。

### 工具调用历史与结果

#### 模型看到什么

成功返回一行——`Generated <n> image(s) with <model>.`——其后是每张已存图像对应的一个图像块。失败则呈现 Seam 自己的消息，其中写明失败条件：未指明或不可用的模型、模型没有的选项、无法读取的参考图、上游拒绝，或无法存储的媒体类型。

#### Token 影响

每张返回的图像会在其后仍然携带它的每次请求中占用视觉 Token，这远大于它旁边那行文本。一次调用生成多张图像会在会话余下部分成倍放大该开销，直到压缩或请求图像卸载将它们替换。

#### KV 缓存影响

仅追加；新可见内容位于可复用的请求前缀之后，不会使已有的 KV 缓存条目失效。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本包不适用的场景，均为当前的包级约束。

- **不发布配套 invariant**——本工具不拥有持久状态，也不拥有可独立观测的关系：Provider 选择归 Seam，存储归 `ctx.attachments`（它校验自己的摘要），而已存引用只经写入它的那个存储读回。
- **不支持视频**——Seam 把视频建模为带自身轮询与取回调用的任务，这需要独立的工具接触面，而不是本工具上的一个参数。
- **不报告成本**——Provider 会报告每次生成的成本，而 Seam 没有承载它的地方，因此它不会抵达结果。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文：开放问题与未定方向。它明确不具权威性——已交付的行为、限制与理由见上文各节。

#### 以附件 id 指定参考图

参考图按路径读取，这需要已挂载的文件系统。接受对话图像的附件 id 需要完整的持久引用，而只有会话日志持有它。尚未决定。

</details>
