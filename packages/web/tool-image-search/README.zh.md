---
description: "面向模型的 find_images 工具：回复如何展示某个主题的真实照片、这些照片来自哪里，以及模型会被告知什么。"
kind: "package-reference"
---

# @aeven/tool-image-search

[English](README.md) | 中文

## 概述

`@aeven/tool-image-search` 注册一个面向模型的工具 `find_images`：它会找到某个主题的真实照片并把它们展示给读者。当问题涉及某个事物实际长什么样——建筑、地点、物件、艺术品、事件——答案用照片给出，而不是描述照片。

图片以普通的 image 内容块返回，因此客户端会把它们画在生成图片所用的同一条通道里，会话日志也以相同方式保存。读者看到的东西对这个工具没有任何特殊之处。

来源是 Wikimedia Commons：它的 API 为每条匹配结果同时返回文件页与许可信息，不需要任何凭据，且其中的历史摄影属于公有领域或开放许可。缺少这些字段的来源无法被引用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在组装会话工具的地方挂载该插件；随附的 `aeven` preset 已带有该行，因此每个会话都能得到这个工具。它需要 `tools` 与 `attachments` 两个服务：后者让找到的图片成为持久附件。

两个字段都可选；非法值会让插件加载失败。

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `requestTimeoutMs` | `20000` | 对 Commons 或对某张图片的单个 HTTP 请求可用的毫秒数。 |
| `maxImageBytes` | `12582912` | 一次调用可存储的最大图片体积。更大的文件不会进入这一行图片。 |

```yaml
- id: tool-image-search
  name: '@aeven/tool-image-search'
  config:
    requestTimeoutMs: 20000
```

<a id="understand-the-implementation"></a>
## 理解实现

一次调用会在 Commons 的 `File:` 命名空间上执行 `generator=search`，只保留媒体类型为位图的结果（`image/jpeg`、`image/png`、`image/webp`——PDF、SVG 或视频都不是照片），把每条匹配结果最宽的缩略图按 1600px 下载下来，并通过 `ctx.attachments.saveImage` 存储。结果同时带有已存储的附件与模型读到的文本。

两个边界让一次调用保持克制：请求期限由配置的超时与调用方的 signal 合并而成；某张图片无法抓取或存储时会被跳过，而不是让整行图片失败。

解析属于 wire 边界：Commons 响应的每个字段都被防御性地读取，无法描述的结果会被跳过，而不是靠猜测补齐。

<a id="model-experience"></a>
## 模型体验

模型看到的工具是 `find_images`，参数为 `query` 与可选的 `count`（1 到 6，默认 3）。它的说明写明了何时该用它——真实存在且被拍摄过的主题、用户索要照片、或图片比文字更能给出答案——以及它绝不能描述自己尚未展示的照片。

结果文本说明找到了什么，并指示模型不要再把这些图片写成 markdown，因为它们已经展示给用户；文本还会列出每个文件的页面与许可，便于回复引用。图片块与这段文本一同返回。

#### KV Cache 影响

无；该工具只贡献一个工具定义，本身不产生请求期文本。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **只有一个来源，且只有单包。** Wikimedia Commons 是唯一提供方，搜索、下载与工具本身都放在这个包里，而不是各自的能力缝（capability seam）。当出现第二个来源，或出现不是工具的消费者时，就应该把提供方拆出去。
- **Commons 未收录的主题没有兜底。** 当代新闻、产品与在世人物大多不在其中。回答这些需要第二个提供方，而不是改动这里。
- **横竖由读者的浏览器判定。** 工具存储文件本身；客户端依据加载后的图片决定每个图块的形状，因此本包不参与一行图片的排布。
- **暂无测试套件。** 该包是在真实会话中跑通的；其 spec，包括 wire 边界解析以及体积与超时边界，仍待补写。
