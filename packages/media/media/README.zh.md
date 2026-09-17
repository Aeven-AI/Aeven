---
description: "生成式媒体服务（ctx.media）：部署方与插件作者如何通过可互换的 provider 生成图片与视频，共享一套选择策略、一套任务词汇与一套错误分类。"
kind: "package-reference"
---

# @aeven/media

[English](README.md) | 中文

## 概述

任何插件或工具都可以通过 `avn-media`（`ctx.media`）生成图片或视频片段，而无需绑定某个厂商的 API。图片与视频 provider 以后端形式接入，服务为每次调用解析出一个 provider，因此调用方无需跟踪某次生成背后跑的是哪家厂商。构建媒体工具或另一个后端时选用它。服务本身不发起网络调用，也不注册任何面向模型的工具：必须先挂载 provider 才能生成任何东西。图片与视频共享一套选择策略、一套取消与错误词汇、一套配置面，因此"本 harness 如何生成媒体"只有一个归属。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与推迟事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

需要生成媒体的组合加载 `avn-media` 服务并至少挂载一个后端——图片 provider、视频 provider 或两者——插件与工具作者随后直接调用 `ctx.media.generateImage()`、`ctx.media.startVideo()`、`ctx.media.videoStatus()` 与 `ctx.media.fetchVideo()`。

### 图片与视频

`generateImage()` 返回字节。`startVideo()` 返回一个任务，因为每个 provider 都把视频当作异步工作；调用方轮询 `videoStatus()` 直到任务报告 `succeeded`，再调用 `fetchVideo()` 取回片段。两个操作都返回 `GeneratedMedia`——一个 IANA 媒体类型与完整产物——因此调用方永远不会收到需要自行获取的 URL。

### provider 选择

选择按调用解析，顺序唯一：请求自带的 `provider`，然后是配置的 `imageProvider` / `videoProvider`，最后是唯一可用的 provider。其余情况都以错误码失败而非静默挑选，因此挂载第二个 provider 不会悄悄改变已经能用的调用。轮询与获取按任务中记录的 provider 路由，绝不重新执行选择，因此任务不会在轮询与获取之间漂移到另一个后端。

### 失败与恢复

每个失败都是携带 `MediaErrorCode` 的 `MediaError`。选择类失败区分被指定但不存在的 provider（`MEDIA_PROVIDER_CONFIGURED_MISSING`）与存在但不可用的 provider（`MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE`），也区分空注册表（`MEDIA_PROVIDER_UNAVAILABLE`）与有歧义的注册表（`MEDIA_PROVIDER_AMBIGUOUS`），因此调用方能分辨配置错误与缺失凭据。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

seam 拥有选择、词汇与任务约定；provider 拥有协议与凭据。图片与视频共享一个 seam，理由与 `avn-web` 中搜索与抓取相同：它们共享 provider 标识、凭据、取消与错误，拆开会把这四样都复制一遍。

### 视频状态联合类型

`MediaVideoStatus` 为 `running | succeeded | failed`。它描述调用方接下来能做什么，而不是上游选择了什么称呼。该词汇沿用 OpenRouter 的，因为它是所调研 provider 中唯一枚举了自身状态的；其他 provider 映射到它。这种映射并非表面功夫——DeepInfra 对正在渲染的任务报告 `queued`，且根本不发布任何运行中状态，因此其适配器把 `queued` 映射为 `running`。若某个 provider 把 `queued` 当作"尚未开始"，它将误报自己运行过的每一个任务。

### 取回字节

`MediaVideoProvider.fetchVideo` 通过 provider 自身的内容路由取回，而不是任务体中携带的任何 URL。中介方的任务体可能指向任意上游 CDN——DeepInfra 指向的是实际服务该模型的厂商——针对这些主机的出口白名单是无界的。通过 provider 取回可以把出口固定在部署已经信任的主机上。

### 源码导航

- `src/types.ts`——请求、结果、任务与 provider 词汇，以及 `MediaError`。
- `src/index.ts`——`MediaRuntime` 服务：注册表、选择与任务路由。
- `src/bytes.ts`——为生成的图像字节打上媒体类型标签的签名嗅探。
- `src/vendor-route.ts`——厂商适配器共享的管道：凭据解析、对同一固定 origin 的 JSON 调用与字节取回、作业体翻译，以及由厂商的路径与请求体组装出的视频 provider。

<a id="model-experience"></a>
## 模型体验

间接体现，通过挂载它的消费方；本服务不注册工具、不贡献提示词，也从不向模型出现。

#### KV 缓存影响

无直接失效；请求前缀的任何变化由消费方拥有。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本服务单独存在时的不完整之处，均为当前包约束。

- **无 invariant 伴随模块**——不发布运行时 invariant 伴随模块，因为该 seam 不拥有任何两个独立观察者可能产生分歧的关系：注册表是单个服务实例私有的，选择是它们的纯函数，因此检查只能复述它所守护的代码。
- **无模型目录**——seam 原样接受 provider 的模型 id，从不校验。哪些模型存在、其中哪些生成视频而非聊天，归属 provider 及其目录配置。
- **无存储**——seam 返回字节后即忘记它们。持久化、保留期与任何可寻址路由属于决定产物存活多久的消费方。
- **无轮询循环**——`videoStatus()` 只报告任务状态一次。调用方拥有自己的节奏，因此工具可以呈现进度而不是阻塞在 seam 内部。
- **无成本或用量报告**——provider 两者都不报告，因此调用方看不到一次生成的花费。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发者备注是面向维护者的工作上下文：尚未决定的方向与开放问题。它明确不具权威性——已交付的行为、限制与理由位于上文各节。

#### 未来：模型目录

provider 知道自己哪些模型生成图片、哪些生成视频，所调研的两家都为其打了标签。这究竟应作为 seam 的目录方法存在，还是像 `avn-llm-pi-ai` 处理聊天目录那样留在各 provider 自己的配置中，尚未决定；由于调用方本就要指名模型，seam 没有它也能工作。

</details>
