---
description: "面向不在模型编写的页面上运行浏览器的 Host 的 ctx.motion 渲染器：为实时播放器打包合成，不渲染影片。"
kind: "package-reference"
---

# @aeven/motion-preview

[English](README.md) | 中文

## 概述

该提供方注册一个只打包的动态影片渲染器。`bundle()` 经由 `ctx.fs` 把合成文件夹复制到私有临时文件夹，并返回其 HyperFrames `bundleToSingleHtml` 结果（内联运行时），由对话中的实时播放器播放。`render()` 会拒绝，因此 Host 上不会有浏览器运行模型编写的页面。托管 Web 挂载它，因为那里一个 Host 服务许多账户。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在提供 `ctx.fs` 的 Host 上于 [`avn-motion`](../motion/README.zh.md) 之后挂载，并在 [`avn-tool-motion`](../tool-motion/README.zh.md) 上设置 `render: false`，使模型不会得到静帧与 `render_motion`。`maxFiles`（默认 500）与 `maxBytes`（默认 64 MiB）限定一次打包读取的文件夹；更大的文件夹会使打包失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

复制过程用 `ctx.fs.listDir` 遍历文件夹，只保留解析后目标位于该文件夹内的普通文件与目录，因此命令放在那里的符号链接无法把其他文件夹的文件带入文档。写出影片的顶层 `renders/` 文件夹会被跳过。随后打包器只读取临时副本，每次打包后删除它。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，经由 [`avn-tool-motion`](../tool-motion/README.zh.md)，它把打包失败（如文件夹超出限定）作为其错误文本报告。

#### KV Cache 影响

渲染器不向请求追加任何内容，因此前缀复用不受影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **无不变量伴随包** — 不发布不变量伴随包：渲染器不持有状态。
- **没有 MP4 导出** — 影片菜单下载打包后的页面；MP4 需要在账户的沙箱内渲染，而该渲染器不会启动它。

<a id="dev-note"></a>
### 开发备注

无。
