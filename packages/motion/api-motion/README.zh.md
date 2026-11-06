---
description: "Motion 卡片背后的浏览器路由：合成文件夹的实时预览打包、用户的 MP4 导出，以及导出影片的字节。"
kind: "package-reference"
---

# @aeven/api-motion

[English](README.md) | 中文

## 概述

`avn-api-motion` 注册 Motion 卡片调用的三条经过认证的 Host 路由：`GET /api/motion/preview?dir=` 返回打包成单一 HTML 文档的合成文件夹，`POST /api/motion/export` 经由 `ctx.motion` 把文件夹渲染为 `renders/<folder>.mp4`，`GET /api/motion/film?path=` 按字节范围流式提供该 MP4，使卡片可以拖动进度。第四条路由 `GET /api/motion/replay?sessionId=&callId=` 从调用方自己的对话日志重建某次 `show_motion` 调用展示的合成，即其成功的 `write` 与 `edit` 调用在该文件夹内产生的文件，并将其打包，使在账户另一台设备上展示的影片在缺少文件夹的地方也能播放。三条文件夹路由只在 `ctx.motion` 存在且 `folderRoutes` 开启时注册，重放路由只在 `ctx.sessionController` 存在时注册；托管 Web 关闭文件夹路由，因此只提供重放。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在提供 `ctx.connection` 与 `ctx.motion` 的 Host 上挂载。`exportQuality`（`draft`、`standard` 或 `high`；默认 `high`）设定用户导出影片的质量。`folderRoutes`（默认 `true`）注册预览、导出与影片路由；服务多个账户的 Host 将其设为 `false`，因为这些路由读取任意 Host 绝对路径，其卡片播放随调用存储的影片。与 `/api/file` 一样，每条路由从请求中读取一个绝对路径；路由运行前由连接服务认证请求，账户 cookie 放行两条 GET 路由，使浏览器无需 bearer 也能加载与下载。

-----

<a id="understand-the-implementation"></a>
## 理解实现

预览路由返回 `ctx.motion.bundle()`，因此场景文件、运行时、图片与字体都在同一个文档中送达。卡片在没有 `allow-same-origin` 的 frame 中以 `srcdoc` 加载该文档，那里无法解析任何相对 URL。每个响应都带有 `Content-Security-Policy: sandbox`，因此在标签页中直接打开某条路由时，不会在应用的源上运行任何内容。导出路由以 JSON 返回影片的路径、大小、时长与尺寸；渲染失败时返回状态 500 与 `{ message }` 正文。影片路由只接受 `.mp4` 路径，并支持一个 `Range: bytes=` 区间。

-----

<a id="model-experience"></a>
## 模型体验

无，因为这些路由服务于浏览器，它们返回的内容不会进入模型请求。

#### KV Cache 影响

没有 token 经过这些路由，因此前缀复用不受影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **重放只看到日志记录的文件写入** — 由命令写入的合成文件、图片或字体资源，以及对话开始前已存在的文件都不在重放中；Windows 文件夹路径在 POSIX Host 上无法解析。
- **无不变量伴随包** — 不发布不变量伴随包：这些路由不持有状态。
- **大型媒体不会内联** — 打包只内联不超过 HyperFrames 单资源大小上限的图片与字体；合成以相对路径引用的视频与音频在预览中不会加载，但导出时会被渲染。
- **预览脚本从网络加载** — GSAP 及合成以 URL 引用的其他库，会在预览 frame 中从其 CDN 加载。

<a id="dev-note"></a>
### 开发备注

无。
