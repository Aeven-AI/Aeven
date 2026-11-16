# Agent Note：回复中的本地图片会被存储并同步

Status: implemented

[English](2026-11-16-reply-image-copies.md) | 中文

## 问题

chat.aeven.io 上的一条回复展示了两张本地预览图：`~/Documents/Aeven/Presentations/Aeven-Presentation-preview.png` 与 `Aeven-for-Business-preview.png`。第一张正常显示，第二张显示“图片不可用”。第一张之所以有存储副本，只是因为该轮次对这个路径调用过 `read_image`：客户端的轮次内 `read-images` 索引把 `read_image` 读取过的路径映射到其附件，而会话同步会把事件引用的每个附件带到账户的其他设备，包括托管 Host。该轮次从未读取第二个文件，而对于工作区之外的路径，客户端没有其他来源：`workspaceImagePath` 对它不返回任何值，而持有该文件的桌面端可能离线。

## 决定

拥有 `read_image` 的 `avn-tool-fs` 在挂载附件存储时还监听 `agent/turn-stopping`。对该轮次 `assistant/message` 事件中每个指向本地文件的 Markdown 图片来源，它按 `read_image` 适用的图片限制把文件存入附件存储，并追加一条 `reply-images/stored` 事件，逐张列出回复的 seq、原样书写的来源与附件。客户端的 `read-images` 索引读取该事件，因此回复通过与 `read_image` 副本相同的会话授权附件读取显示存储副本。`confineToWorkspace` 把副本限定在会话工作区内。缺失、不可读、过大或不是图片的来源会被跳过，并保留其书写的来源。

作为本次变更之前所写回复的回退，`workspaceImagePath` 现在把工作区之外的本地路径原样交给 `/api/workspace-file`；服务该会话的 Host 按自身的读取规则解析它，限制读取范围的 Host 返回 404。

## 考虑过的替代方案

**依赖工作区文件同步。** 文件同步在设备间同步文件夹工作区，从不同步其外的文件，也从不同步到托管 Host，因此保存在 `~/Documents` 下的预览图在桌面端离线时仍然没有来源。

**回退到更早轮次中同一路径的存储副本。** 预览图在每次修订时都会被重写，因此旧副本会把过时的图片当作当前图片显示。

## 影响

新事件类型在读取时为必需：早于它的构建会拒绝包含它的日志，因此托管 Host 必须与桌面端一同更新。每个结束的轮次都会读取并存储其回复所指的本地图片；存储按内容寻址，因此 `read_image` 已存储过的文件不会增加字节。

## 验证

`@aeven/tool-fs` 与 `@aeven/client-ui-chat` 的 `tsc` 通过，`pnpm run build:client` 成功。线上检查方式：在桌面端离线时，于 chat.aeven.io 打开一条展示工作区之外本地图片的新回复。
