---
description: "面向只在调用方账户沙箱内运行模型编写页面的 Host 的 ctx.motion 渲染器：为实时播放器打包合成，并通过沙箱的 render-motion 渲染影片。"
kind: "package-reference"
---

# @aeven/motion-sandbox

[English](README.md) | 中文

## 概述

该提供方注册托管 Web 使用的动态影片渲染器：那里一个 Host 服务许多账户，任何浏览器都不得在账户 jail 之外运行模型编写的页面。`bundle()` 经由 `ctx.fs` 把合成文件夹复制到私有临时文件夹，并返回其 HyperFrames `bundleToSingleHtml` 结果（内联运行时），由对话中的实时播放器播放。`render()` 在调用会话的沙箱策略下把该文档通过管道送入沙箱的 `render-motion` 命令；该命令逐帧驱动合成自身的播放器，在账户文件夹内写出 H.264 MP4，并返回影片信息与请求的静帧。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在提供 `ctx.fs` 与沙箱化 `ctx.shell`（例如安装了 `render-motion` 的 [`avn-sandbox-jail`](../../sandbox/sandbox-jail/README.zh.md)）的 Host 上，于 [`avn-motion`](../motion/README.zh.md) 之后挂载。每个渲染请求都必须携带调用会话的沙箱策略，由 [`avn-tool-motion`](../tool-motion/README.zh.md) 与 [`avn-api-motion`](../api-motion/README.zh.md) 提供；缺少策略的请求会失败。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxFiles` | `500` | 一个合成文件夹最多可含的文件数；更大的文件夹会使打包失败 |
| `maxBytes` | `64 MiB` | 文件夹内文件的最大总字节数 |
| `command` | `render-motion` | 渲染页面的沙箱命令 |
| `timeoutMs` | `600000` | 一次渲染可运行的时长 |
| `resultMaxBytes` | `32 MiB` | 命令 JSON 结果（含静帧）的最大字节数 |
| `crf` | `30` / `23` / `18` | `draft` / `standard` / `high` 的 H.264 恒定码率因子 |
| `stillWidth` | `960` | 返回静帧的像素宽度 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

复制过程用 `ctx.fs.listDir` 遍历文件夹，只保留解析后目标位于该文件夹内的普通文件与目录，因此命令放在那里的符号链接无法把其他文件夹的文件带入文档。写出影片的顶层 `renders/` 文件夹会被跳过。渲染先要求合成文件夹与输出路径都解析在策略的工作区根内，再以标准输入传入打包文档运行 `render-motion - <out.mp4> --json`，因此页面从不接触账户文件夹；命令标准输出的最后一行是其 JSON 结果。影片大小取自 `ctx.fs.stat`，编码器为沙箱的 libx264。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，经由 [`avn-tool-motion`](../tool-motion/README.zh.md)，它把打包或渲染失败（如文件夹超出限定，或合成始终未报告就绪）作为其错误文本报告。

#### KV Cache 影响

渲染器不向请求追加任何内容，因此前缀复用不受影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **无不变量伴随包** — 不发布不变量伴随包：渲染器不持有状态。
- **沙箱镜像必须带有当前的 `render-motion`** — 由 `host/install-motion.sh` 安装；不支持 `-` 与 `--json` 的旧版本会使每次渲染失败。

<a id="dev-note"></a>
### 开发备注

无。
