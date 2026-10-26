---
description: "对话 UI 的附件呈现：草稿图片栏、文档拖放目标、历史图片画廊与原图灯箱；供 Web 附件体验的用户与维护者阅读。"
kind: "package-reference"
---

# @aeven/client-ui-attachment

[English](README.md) | 中文

## 概述

本包渲染对话 UI 中与附件相关的一切：composer 中的草稿托盘、全视口拖放邀请层、Chat 与 Trajectory 中已发送的附件，以及图片画廊。它是纯呈现层——附件数据、图片加载与回调都经声明槽位来自 conversation 包。需要 Aeven Web 客户端的附件体验时选择它：图片与文件在 composer 和已发送消息中共用同一个图块网格。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

与 [`ui-conversation`](../ui-conversation/README.zh.md) 一起挂载本插件；它等待 conversation 包的槽位声明，并把自身表面注册进这些槽位。用户随即看到：带逐块删除与点击打开的草稿托盘、带上限说明的拖放遮罩、位于用户消息内的已发送附件图块网格，以及图片画廊。

### 草稿托盘

草稿附件以 80px 图块呈现，每行五个并换行：先是裁切填充的图片缩略图，再是带类型图标与名称的文件；视频文件使用播放图标，MP3 文件使用音符图标。上传中的文件显示加载图标，失败的显示错误图块。单击图片在全部草稿图片上打开画廊；单击文件在新标签页打开其字节。

### 已发送附件与画廊

带附件的用户消息（`layout: 'tray'`）渲染为一张卡片：上方是图块网格，下方是文本，每个图块使卡片最小宽度增加栏宽的五分之一，最多五个。提交回显用本地预览显示同样的图块。已发送消息的图片图块在预览来源变为持久引用时保留位置标识，使已加载的缩略图在消息接收过程中保持挂载。持久 URL 解析期间，图块保留已显示的 URL，且仅在图片首次加载时淡入。助手、工具与 Trajectory 图片（`layout: 'gallery'`）保留按数量定尺寸的画廊：单图按长边 240px，多图为 64px 方块。画廊以选中图片铺满视口，提供信息浮层（类型、大小、名称）、下载与关闭，多于一张时提供上一张／下一张；Escape 关闭，方向键循环切换。图片图块显示放大指针，并在其所属 Turn 的全部图片上打开该画廊；信息中的名称取存储的文件名，附件未存名称时则取由摘要派生的名称。

### 拖放遮罩

文件拖拽悬停页面时，全视口遮罩宣布可拖放：插画、标题，接受拖放时再加一行上限说明。遮罩只呈现状态——接受或拒绝由持有方的 document 级监听器决定。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

插件通过 `ctx.slots.inject` 等待 `conversation.input.attachments`、`conversation.message.images` 与 `conversation.trajectory.images`。随后它注册 composer 托盘、文档拖放目标，以及供 Chat 和 Trajectory 使用的已发送附件渲染器；所有图片都打开 ui-primitives 画廊。呈现组件保持纯 props：conversation 槽位持有方提供附件数据、图片加载、回调与语言包翻译器；包入口不导出任何组件。

| 文件 | 职责 |
|---|---|
| [`src/client/ComposerAttachments.tsx`](src/client/ComposerAttachments.tsx) | 草稿图片栏＋拖放遮罩的组装 |
| [`src/UploadTray.tsx`](src/UploadTray.tsx) | composer 与已发送消息共用的可换行图片与文件图块网格 |
| [`src/client/MessageImages.tsx`](src/client/MessageImages.tsx) | 按持有方的 `layout` 渲染已发送消息托盘或按数量定尺寸的画廊 |
| [`src/MessageImage.tsx`](src/MessageImage.tsx) | 单图尺寸、加载／重试、点击打开；本地提交回显预览直接显示其 object URL |
| [`src/message-image-entry.ts`](src/message-image-entry.ts) | 托盘与画廊共用的原图预览条目元数据——显示名称、媒体类型、字节大小 |
| [`ImageLightbox`](../ui-primitives/src/ImageLightbox.tsx)（ui-primitives） | 带信息、下载与上一张／下一张的文档级图片画廊 |
| [`src/DropOverlay.tsx`](src/DropOverlay.tsx) | 不接收指针事件的拖拽邀请 portal |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当附件面不够用时阅读以下页面。它们从本包填充的槽位进入拥有输入流程的会话外壳。

- [ui-conversation](../ui-conversation/README.zh.md)——声明附件槽位并拥有 composer 与图片摄入。
- [Web 客户端架构](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.zh.md)——浏览器插件行如何加载并注册槽位。
- [客户端包映射](../README.zh.md)——相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该插件只渲染由对话 UI 提供的附件状态，不贡献模型可见输入。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前附件表面。它们是包约束，不是通用图片查看器对比或任务积压。

- **回显文件无法打开**——提交回显中的文件图块在 Host 接纳消息前没有已存储的原件，单击不做任何事。
- **画廊无缩放**——图片仅以适配视口的尺寸渲染。
- **画廊不锁定焦点**——它设置 `aria-modal` 并在关闭时归还焦点，但 Tab 仍可移动到背后的页面。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包只贡献 effect 所有的 slot entry；slot 注册表负责其生命周期并校验声明。
