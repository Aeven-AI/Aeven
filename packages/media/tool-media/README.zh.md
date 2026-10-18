---
description: "ctx.media 之上的 generate_image 与 generate_video 工具：解析请求、经选定 Provider 生成、并把字节存为会话内的持久附件的面向模型接触面。"
kind: "package-reference"
---

# @aeven/tool-media

[English](README.md) | 中文

## 概述

`avn-tool-media` 发布 `generate_image`，并在配置了 `video` 时发布 `generate_video`：即生成式媒体 Seam 面向模型的接触面。每个工具解析一次调用的模型与 Provider 并经 `ctx.media` 生成；图像用 `ctx.attachments` 存为持久图像块，成片存为持久文件块，而不是文件或 URL。请在已加载 `avn-media` 且至少有一个图像 Provider 的组合中挂载它；设置了 `video` 时还需一个视频 Provider。

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

`choices` 是可选模型的完整集合，每项都指明自己的 Provider。它非空时，选择器、`/image-model` 命令以及调用指明的模型都限于该列表，因此列表之外的模型会在任何生成之前被拒绝。内置 Preset 列出 `Aeven-1.0-Image-Flash` 与 `Aeven-1.0-Image-Pro`，默认 Flash，并设置 `confirmModel: false`，因此首次生成不经询问直接使用 Flash，`/image-model` 用于更改已存储的选择：不带参数的行会打开选择器，而 `/image-model <provider>/<model>`（或恰好只有一个可选模型使用的模型 id）会直接存储该模型。

`listedProviders` 指定一些媒体 Provider，它们自己的图像模型列表会排在 `choices` 之后提供。该列表在每次调用时读取，因此选择器、`/image-model` 与调用校验会跟随在运行时变化模型的 Provider。内置 Preset 指定 `grok-subscription` 与 `codex-subscription`，它们的图像模型在订阅已登录、且该模型在 设置 → 提供方 中开启时被列出。

挂载两个图像 Provider 的部署需要固定其一，或在此处、或作为 Seam 的 `imageProvider`：选择存在歧义时，Seam 会报错而不是猜测。

`video` 以同样的 `model`、`provider`、`choices`、`confirmModel` 与 `maxReferenceImageBytes` 字段配置 `generate_video`，存于独立的 `media-video` 设置文档，另有用于等待任务的 `pollIntervalMs`（默认 5 秒）与 `maxWaitMs`（默认 31 分钟）。省略 `video` 时既不注册该工具，也不注册 `/video-model`。随附预设提供 `Aeven-1.0-Video-Flash`（默认）与 `Aeven-1.0-Video-Pro`，以 `confirmModel: false` 将 Video Flash 设为默认，`/video-model` 修改已存储选择的方式与 `/image-model` 对图像的方式完全相同。

### 请求

`prompt` 是唯一必填参数。`model` 为单次调用覆盖所选模型，并由其 choice 指明的 Provider 服务。`n`、`size`、`resolution`、`seed` 与 `background` 转发至 Seam；`guidance_scale`、`output_format` 与 `optimize_prompt_mode` 映射为其驼峰命名字段；只发送调用实际设置的字段，其余沿用 Provider 自身的默认值，Provider 会拒绝所选模型没有的选项。`n` 自身不携带上限：数量因模型与 Provider 而异，因此工具指明该数量由所选模型的描述持有，更大的请求应改为再次调用。`reference_images` 按 prompt 引用的顺序列出图像文件；每个文件在会话工作目录下经由 `ctx.fs` 读取，受 `maxReferenceImageBytes`（默认 4 MiB）限制，按其字节识别格式，并作为参考图发送给 Provider。对话中的图像通过其句柄文本显示的规范化副本路径传入。

`generate_video` 同样只需 `prompt`。`model` 为单次调用覆盖所选视频模型；`duration`、`resolution`、`aspect_ratio`、`seed` 与 `generate_audio` 转发至 Seam 的视频请求；`reference_images` 最多列出两张图像，按上述方式读取，Provider 将其用作首帧与尾帧。

每次 `generate_video` 调用都必须在 provider 启动任务前取得独立的用户确认。问题展示所选模型、请求的时长、分辨率、宽高比和提示词。只有明确选择 `Generate video` 才授权该次调用；取消、自由文本及先前的模型选择均不构成授权。没有确认 UI 的调用在到达 provider 前失败。重试或再次渲染需要重新确认。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`resolveRequest` 把默认值填充做成一个显式步骤，因此既未指明模型、也没有配置默认值的调用会按名报错，而不是以空 id 抵达某个 Provider。`choices` 限制也在这里执行，因为无论选择器做了什么，每次生成都要经过它。

`readReferences` 经由已挂载的文件系统后端读取参考图，因此工作区文件与对话图像的规范化副本以同样方式读取。在未挂载文件系统时指明参考图的调用会按名报错。

`storable` 把生成的媒体类型收窄到第一版附件路径能存储的四种位图格式。Provider 可能返回别的东西——OpenRouter 按请求提供 SVG，签名无法识别的字节会被标为 `application/octet-stream`——这些在此处连同类型名一起被拒绝，而不是在存储层变成一句无信息的拒绝。

`imageBlockRef` 恢复输出 Schema 压平成字符串的 `AttachmentId` 品牌类型。字节由本工具经 `saveImage` 存入，因此该品牌成立，无需二次读取存储。`fileBlockRef` 对经 `saveFile` 存入的成片做同样的事。

`generate_video` 启动 Provider 的任务，随后 `awaitVideo` 每隔 `pollIntervalMs` 读取一次，直到成功、失败或超过 `maxWaitMs`；调用的中止信号会结束等待。成片经 `saveFile` 以模型名存储，并附一行写明模型与 prompt 的文本，模型读到的就是这行文本而非字节。模型选择字段、选择器以及 `/image-model` 与 `/video-model` 命令都来自每种类型各一次的 `installSelection`，因此二者行为一致。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 Schema

#### 模型看到什么

模型看到生成的 [`generate_image` Schema](../../../docs/tool-catalog.zh.md#aeventool-media)：一个必填的 `prompt` 和可选控制项——用于单次调用覆盖的 `model`；用于受支持生成设置的 `n`、`size`、`resolution`、`seed`、`guidance_scale`、`output_format`、`optimize_prompt_mode` 与 `background`；以及用于编辑或基于现有图像绘制的 `reference_images`。描述要求原样保留用户提供的完整提示词，说明如何传入参考图，以及每个已配置的 choice 及其描述和默认项，使模型知道哪个模型具备哪个选项、单次调用可以向它请求多少张图像，以及更大的请求应改为再次调用；它还告诉模型不要再调用其他工具去定位或校验图像，因为附件本身就是结果。[`generate_video` Schema](../../../docs/tool-catalog.zh.md#aeventool-media) 具有同样的 `prompt`、`model` 与 `reference_images` 参数，另加 `duration`、`resolution`、`aspect_ratio`、`seed` 与 `generate_audio`，其描述列出视频 choice，并说明生成需要数分钟。

#### Token 影响

在工具可见的每次请求上都是固定的 Schema 开销。对给定的组合配置而言，描述与 Schema 是稳定的；描述列出的是组合的 choices 与默认项，而不是用户之后存储的选择。

#### KV 缓存影响

只要定义与可见性不变，前缀保持稳定。插件生命周期或作用域限制可能使基于该 Schema 的复用失效。

### 工具调用历史与结果

#### 模型看到什么

成功返回一行——`Generated <n> image(s) with <label>. Charged $<amount> to the user's Aeven account. Already displayed to the user; do not repeat or embed them in your reply.`——其后是每张已存图像对应的一个图像块。Imagine 在生成调用位置渲染这些块，包括进行中的占位视图；无需助手复述。失败则呈现 Seam 自己的消息，其中写明失败条件：未指明或不可用的模型、模型没有的选项、无法读取的参考图、上游拒绝，或无法存储的媒体类型。视频成功时返回 `Generated a video with <label>. Charged $<amount> to the user's Aeven account. Already displayed to the user with playback controls; do not repeat or embed it in your reply.`，其后是一个文件块，它以 `<attached_file>` 元素到达模型，携带已存文本与成片路径；Imagine 在调用位置播放它。`<label>` 是所提供 choice 的标签，例如 Aeven Video Pro；扣费句仅在 Provider 报告费用时出现。任务失败或超时时呈现 Provider 给出的原因。

#### Token 影响

每张返回的图像会在其后仍然携带它的每次请求中占用视觉 Token，这远大于它旁边那行文本。一次调用生成多张图像会在会话余下部分成倍放大该开销，直到压缩或请求图像卸载将它们替换。

#### KV 缓存影响

仅追加；新可见内容位于可复用的请求前缀之后，不会使已有的 KV 缓存条目失效。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本包不适用的场景，均为当前的包级约束。

- **不发布配套 invariant**——本工具不拥有持久状态，也不拥有可独立观测的关系：Provider 选择归 Seam，存储归 `ctx.attachments`（它校验自己的摘要），而已存引用只经写入它的那个存储读回。
- **视频调用在整个渲染期间占用其工具位**——任务在调用内等待，因此数分钟的渲染会让调用一直保持打开；在此期间模型无法在该轮做其他工作。
- **仅在 Provider 报告时给出费用**——只有 Provider 设置了 `costUsdMicros` 时结果才会说明扣费；否则不写任何价格，模型也没有其他来源。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文：开放问题与未定方向。它明确不具权威性——已交付的行为、限制与理由见上文各节。

#### 以附件 id 指定参考图

参考图按路径读取，这需要已挂载的文件系统。接受对话图像的附件 id 需要完整的持久引用，而只有会话日志持有它。尚未决定。

</details>
