---
description: "Web GUI 的分享操作：助手消息操作行中位于分支之前的分享按钮、带缩略图和链接的分享对话框，以及链接管理器。"
kind: "package-reference"
---

# @aeven/client-ui-message-share

[English](README.md) | 中文

## 概述

本包为 Web GUI 添加分享功能。它向已完成助手消息的操作条贡献 `share` 条目，即紧挨分支之前的 lucide `share-2` 按钮。按钮打开一个对话框，开头是链接在聊天应用中展开时显示的卡片，说明链接会公开这条回复，并提供 **管理** 和 **创建链接**。创建链接通过 [host-message-share](../../host/message-share/README.zh.md) 的 `messageShare` Remote 发布消息并复制 URL，在触屏设备上则打开系统分享面板；处理期间，旋转图标取代其链接图标，按钮保持宽度。管理的标题为 **已创建的链接**，列出已登录账户创建的所有链接，随列表滚动加载更多，每个链接都有删除操作，另有需确认的 **删除所有链接**。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

与 `ui-conversation` 和 Host 的 `host-message-share` 行一起挂载本插件。分享按钮出现在每轮收尾助手消息的操作行中，位于反馈和朗读之后、分支之前。对话框使用产品的 `Modal`；所有文案都在 `share` 语言命名空间中，提供中文、英文和西班牙文。

### 失败

分享被拒绝时，失败信息显示在缩略图下方，对话框保持打开。链接管理器加载某页失败时显示失败信息和重试操作；删除失败时该行保持原位。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

本包注册 `conversation.chat.assistant-actions` 的 `share` 条目（order 30）。其注入面把 Session id 绑定进基于 `ctx.remote.messageShare` 的五个动词，并把载体失败折叠为 `unavailable` 代码。缩略图是每次打开对话框时 `preview` 动词请 Aeven API 绘制的预览卡片，与链接存储的图片相同；加载期间由 #f2f2f2 底和黑色加载标记占住 3:2 的位置，图片加载完成后淡出；预览被拒绝时不显示缩略图。链接管理器用 API 游标分页，当最后一行下方的哨兵进入列表滚动区域时加载下一页。

| 文件 | 作用 |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | 插件入口：词典和插槽条目 |
| [`src/client/ShareAction.tsx`](src/client/ShareAction.tsx) | 按钮及当前打开的对话框 |
| [`src/client/ShareDialog.tsx`](src/client/ShareDialog.tsx) | 分享对话框：缩略图、链接字段、管理和创建链接 |
| [`src/client/ManageLinksDialog.tsx`](src/client/ManageLinksDialog.tsx) | 带分页、单个删除和全部删除确认的链接管理器 |
| [`src/client/ShareThumb.tsx`](src/client/ShareThumb.tsx) | 加载并显示预览卡片 |
| [`src/client/locales.ts`](src/client/locales.ts) | `share` 词典 |

</details>

-----

<a id="model-experience"></a>
## 模型体验

无；分享从不进入 Session 日志、模型上下文或遥测。

#### KV Cache 影响

无；分享不触及任何请求内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **缩略图需要 Aeven API**：卡片在那里绘制，因此没有连接或未登录账户时，对话框打开时不带缩略图。
- **仅聊天视图**：轨迹视图和瀑布视图不渲染分享操作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>

**运行时不变量：** 不发布配套。本插件拥有一个插槽注册和一个词典注册，两者都由各自的 effect 释放，因此运行时不存在需要核对的第二个权威。
