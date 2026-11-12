---
description: "分享助手消息的公开链接：messageShare Remote 把一条消息发布到 Aeven API，列出已登录账户的链接，并删除它们。"
kind: "package-reference"
---

# @aeven/host-message-share

[English](README.md) | 中文

## 摘要

`@aeven/host-message-share` 让已登录用户把一条已完成的助手消息发布到一个公开 URL，不含引出它的提问。Host 从持久化的 Session 日志构建快照，从不使用浏览器发来的文本，并用该用户自己的 `AEVEN_TOKEN` 发送到 Aeven API 的 `/api/shares` 路由；API 把每个链接归到该账户名下，并在 `/s/<shareId>` 提供页面。再次分享同一条消息会刷新同一个链接背后的快照。`messageShare` Remote 还能分页列出账户的链接，并删除其中一个或全部；浏览器一侧是 [ui-message-share](../../client/ui-message-share/README.zh.md)。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`avn-web-app` bundle 挂载它，`apiUrl` 取自 `AEVEN_API_URL`，`workspaceMount` 设为 `workspace-files` 行的挂载路径。它需要 `sessionPersistence`、`sessions`、`credentials` 和 `identityUsers`；存在时会读取 `attachments` 和 `workspaceRegistry`。

### 配置

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `apiUrl` | 必填 | 存储并提供链接的 Aeven API 源；HTTPS，或回环地址上的 HTTP。 |
| `credentialRef` | `AEVEN_TOKEN` | 保存每个用户 Aeven 访问令牌的凭据。 |
| `timeoutMs` | `60000` | 单次 API 调用的时间预算。 |
| `workspaceMount` | 无 | workspace-files 路由的路径前缀，使由它提供的 Markdown 图片得以发布；省略时这类图片会被丢弃。 |
| `maxImages` | `8` | 一次分享携带的图片数；之后的图片会被丢弃。不得超过 API 的 `shares.maxImages`。 |
| `maxImageBytes` | `4194304` | 一次分享携带的单张图片上限；更大的图片会被丢弃。不得超过 API 的 `shares.maxImageBytes`。 |
| `imageMaxPixels` | `2560000` | 图片内容块发送前缩放到的像素预算。 |
| `imageTargetBytes` | `409600` | 图片内容块发送前压缩趋近的编码大小。 |

### Remote 方法

| 方法 | 请求 | 值 |
| --- | --- | --- |
| `create` | `{ sessionId, messageId }` | 链接：`shareId`、`url`、`title`、`sessionId`、`messageId`、`createdAt`、`updatedAt` |
| `list` | `{ cursor? }` | `{ items, nextCursor }`，最新的在前；最后一页的 `nextCursor` 为 `null` |
| `delete` | `{ shareId }` | `{ removed: true }` |
| `deleteAll` | 无 | `{ removed }`，删除的链接数 |

每个方法都返回 `{ ok: true, value }` 或 `{ ok: false, error: { code } }`，其中 `code` 为 `signed-out`、`session-not-found`、`target-not-found`、`too-large`、`share-limit`、`not-found` 或 `unavailable`。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

### 快照

目标是消息 id 匹配的追加来源 `assistant/message` 事件；被中断的消息会被拒绝。只发布这条消息，从不发布 `user/message`，因此问题和注入的上下文都不会进入公开页面。它的文本块成为 Markdown，其后是图片块，标题取该 Markdown 的第一行。若活跃 Session 尚未存储该消息，Host 会先刷新它再重新读取日志。

### 图片

Markdown 用 `share-image:n` 指代第 `n` 张图片，字节以 base64 编码随附；API 会重新编码它们。图片内容块从附件存储读取为缩小后的副本，像素不超过 `imageMaxPixels`，大小接近 `imageTargetBytes`。Markdown 图片在其来源是 Session 工作目录或某个已注册工作区内的文件时发布，可以是路径，也可以是 workspace-files 路由上的 URL；真实路径必须位于这些根目录之一内。`https` 或 `data:` 图片保持原样，其他来源只保留替代文本，因为公开页面的读者无法加载它们。

### 源码地图

| 文件 | 作用 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `MessageShareService`：配置、`messageShare` Remote、Session 检查 |
| [`src/snapshot.ts`](src/snapshot.ts) | 在日志中找到消息，并构建 Markdown、标题与图片 |
| [`src/api.ts`](src/api.ts) | `/api/shares` 客户端，以及 API 拒绝到失败代码的映射 |
| [`src/types.ts`](src/types.ts) | Remote 请求、值和失败类型 |
| — | 不发布运行时不变量配套；链接只存在于 Aeven API 上，Host 没有可供核对的第二份观察。 |

</details>

-----

<a id="model-experience"></a>
## 模型体验

无；分享只读取 Session 日志而从不追加，模型收到的请求没有任何变化。

#### KV Cache 影响

无；分享不触及任何请求内容。

## 已知限制与延后工作

- **仅最后一步**：回复是该轮次的收尾助手消息，与复制操作取用的文本相同；模型在该轮次较早步骤中写的文本不会发布。
- **已删除的链接可能留在缓存中**：聊天应用和社交网站会保留它们抓取的预览卡片，API 提供的图片带有一小时缓存。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
