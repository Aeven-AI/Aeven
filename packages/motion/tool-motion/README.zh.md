---
description: "基于 ctx.motion 的 render_motion 工具与 motion 技能：把工作区中的 HyperFrames 合成文件夹渲染为对话可播放的 MP4，并可返回供审阅的静帧。"
kind: "package-reference"
---

# @aeven/tool-motion

[English](README.md) | 中文

## 概述

`avn-tool-motion` 注册 `show_motion`、`render_motion` 与 `motion` 技能。技能教模型规划影片、在工作区中编写 [HyperFrames](https://github.com/heygen-com/hyperframes) 合成、展示它、审阅静帧并修改。`show_motion` 把合成文件夹交给 Imagine 的 Motion 卡片，卡片实时播放它，并在用户请求时导出为 MP4；它还把文件夹打包成一个 HTML 文档存为文件附件，使缺少该文件夹的账户其他设备也能播放同一部影片；带 `stills` 时，它还会渲染一份用后即弃的草稿，其帧返回给模型。`render_motion` 把文件夹渲染为放在其内部的 MP4，并把影片存为对话文件附件，用于用户向模型索要文件的情形。二者都等待 `ctx.motion`，因此没有渲染器的组合两者都不会出现。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在提供 `ctx.tools`、`ctx.attachments` 与 `ctx.fs` 的 Host 组合旁按会话挂载。工具与技能只在 `ctx.motion` 存在时注册，因此没有渲染器的组合会激活该插件但不注册任何内容；`ctx.skills` 为可选项，用于添加该技能及 `/motion`。`maxStills`（默认 8，最多 16）限制一次调用可请求的静帧数量。

两个工具都需要必填的 `composition`。它像文件系统工具那样经由 `ctx.fs` 解析：相对会话工作目录，或对于没有工作目录的聊天，相对沙箱策略的工作区根目录。`output` 默认为合成文件夹内的 `renders/<folder>.mp4`。`show_motion` 可选 `stills`；`render_motion` 可选 `fps`、`quality` 与 `stills`。两个路径都必须位于会话的工作区根目录内，会话没有时则位于策略的根目录内。

-----

<a id="understand-the-implementation"></a>
## 理解实现

工具校验参数，通过 `ctx.motion.resolve()` 解析请求并渲染。它用 `saveFile` 存储 MP4，用 `saveImage` 存储每张静帧。存储被拒（如超出附件大小上限）时，影片仍保留在磁盘上，结果报告拒绝原因而不让调用失败。结果复用 [`avn-tool-media`](../../media/tool-media/README.zh.md) 的 `fileBlockRef` 与 `imageBlockRef` 来恢复附件品牌类型。Imagine 客户端把 `render_motion` 列入其视频工具，因此由同一张卡片播放影片。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到的内容

[`render_motion` schema](../../../docs/tool-catalog.zh.md#aeventool-motion)：必填的 `composition` 文件夹，以及可选的 `output`、`fps`、`quality` 与 `stills`。描述说明了文件夹结构、渲染耗时约等于影片时长，以及影片会直接展示给用户、无需复述。

#### Token 影响

工具可见的每次请求都有固定的 schema 成本。

#### KV Cache 影响

定义与可见性不变时，前缀保持稳定。

### 技能

#### 模型看到的内容

技能目录列出 `motion` 及其描述。加载后返回规划、合成、手艺以及渲染与审阅的说明。

#### Token 影响

目录条目每次请求约花费几十个 token；加载的正文每次加载约 1,800 个 token。

#### KV Cache 影响

技能注册期间目录条目保持稳定。加载的正文追加到历史中。

### 工具调用历史与结果

#### 模型看到的内容

一行文字给出 MP4 的相对路径、时长与尺寸，并说明影片已展示，或无法附加的原因。随后是影片的文件块，以及每张静帧的图片块。

#### Token 影响

影片是一个文件块，模型读取其存储的文本。每张静帧在之后携带它的每次请求中都会消耗视觉 token，直到压缩或请求图片卸载将其替换。

#### KV Cache 影响

仅追加；不会使先前的前缀复用失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **无不变量伴随包** — 不发布不变量伴随包：工具不持有持久状态；存储与渲染分别由 `ctx.attachments` 与 `ctx.motion` 负责。
- **没有实时预览** — 用户看到的是渲染出的 MP4，而不是可拖动预览中播放的合成，修改通过对话进行。
- **渲染会占住调用** — 整个渲染期间调用保持打开，调用处不显示进度。

<a id="dev-note"></a>
### 开发备注

无。
