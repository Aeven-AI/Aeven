---
description: "面向模型的 find_images 工具：回复如何展示某个主题的真实照片或以卡片展示新闻、这些内容来自哪里，以及模型会被告知什么。"
kind: "package-reference"
---

# @aeven/tool-image-search

[English](README.md) | 中文

## 概述

`@aeven/tool-image-search` 注册一个面向模型的工具 `find_images`：它会找到某个主题的真实照片并把它们展示给读者。当问题涉及某个事物实际长什么样——建筑、地点、物件、艺术品、事件——答案用照片给出，而不是描述照片。对于新闻，同一个工具会把模型选定的文章做成卡片：每则新闻的图片、标题、开头文字与来源。

图片以普通的 image 内容块返回，因此客户端会把它们画在生成图片所用的同一条通道里，会话日志也以相同方式保存。读者看到的东西对这个工具没有任何特殊之处。

照片优先来自 Wikimedia Commons：它的 API 为每条匹配结果同时返回文件页与许可信息，不需要任何凭据，且其中的历史摄影属于公有领域或开放许可。部署挂载了 `web` 缝时，Commons 未收录的内容由它补足——每个结果页自己发布的图片，并以该页面作为引用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在组装会话工具的地方挂载该插件；随附的 `aeven` preset 已带有该行，因此每个会话都能得到这个工具。它需要 `tools`、`attachments` 与 `llm` 三个服务：`attachments` 让找到的图片成为持久附件，`llm` 用于翻译卡片。`web` 服务可选；没有它就没有卡片，照片也只来自 Commons。

所有字段都可选；非法值会让插件加载失败。

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `requestTimeoutMs` | `20000` | 单个 HTTP 请求——对 Commons、一次网页搜索、一个页面或一张图片——可用的毫秒数。 |
| `translationTimeoutMs` | `30000` | 翻译卡片的模型调用可用的毫秒数。 |
| `maxImageBytes` | `12582912` | 一次调用可存储的最大图片体积。更大的文件不会进入这一行图片。 |

工具自身的期限是四个请求加上翻译，因为一次调用最多先后发出四轮请求。

```yaml
- id: tool-image-search
  name: '@aeven/tool-image-search'
  config:
    requestTimeoutMs: 20000
```

<a id="understand-the-implementation"></a>
## 理解实现

一行照片会在 Commons 的 `File:` 命名空间上执行 `generator=search`，只保留媒体类型为位图的结果（`image/jpeg`、`image/png`、`image/webp`——PDF、SVG 或视频都不是照片），并按 1600px 请求每条匹配结果的缩略图。Commons 返回的数量不够时，由网页搜索补足：抓取每个结果页，以其 `og:image` 或 `twitter:image` 作为照片。

卡片不走 Commons，因为文件名不是标题。带 `urls` 时抓取每篇指定文章；不带时由网页搜索提供页面。一张卡片由页面发布的图片、标题（搜索结果标题，其次 `og:title`，再次 `<title>`）和开头文字组成：取 `<article>` 或 `<main>` 中不属于页面杂项（如图片署名或关注提示）的前几段，最多 320 个字符，没有时退回页面描述。文字会解码 HTML 实体，页面转义了两次时解码两次，并在句子或完整单词处截断，绝不截在单词中间。

页面并行抓取；图片按行内仍缺的数量分批并行下载，并通过 `ctx.attachments.saveImage` 存储，失败的文件由下一个候选补上。每个请求都有自己的 `requestTimeoutMs` 期限，并与调用方的 signal 合并。某个页面或图片失败时会被跳过，而不是让整个调用失败。

调用指定了 `language` 时，会话自己的模型在独立的 `translationTimeoutMs` 期限内翻译卡片的标题与开头；翻译失败或超时则保留原文。该工具可与同批的其他调用并行（`isConcurrencySafe`），因为附件存储按内容为文件寻址。

解析属于 wire 边界：Commons 响应的每个字段和每个页面都被防御性地读取，无法描述的结果会被跳过，而不是靠猜测补齐。

<a id="model-experience"></a>
## 模型体验

模型看到的工具是 `find_images`，参数为 `query`、`count`（1 到 6，默认 3）、`layout`（`row` 或 `cards`）、`urls`（配合 `cards`，最多 10 个文章页面，每个一张卡片）、`language` 与 `translations`。调用需要 `query` 或 `urls` 之一。它的说明写明了何时该用它——真实存在且被拍摄过的主题、用户索要照片、或图片比文字更能给出答案——它绝不能描述自己尚未展示的照片，以及新闻应把选定的文章作为 `urls` 并使用 `cards`。

对于一行照片，结果文本指示模型不要再把这些图片写成 markdown，因为它们已经展示给用户，并列出每个文件的页面与许可，便于回复引用。对于卡片，它告诉模型这些新闻已经展示、每张都链接到原文，不要再以链接或标题列表重复。第二个文本块以 JSON 携带条目，供客户端的卡片视图使用；图片块随后。

#### KV Cache 影响

无；该工具只贡献一个工具定义，本身不产生请求期文本。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **单包，而非能力缝。** Commons 搜索、页面抓取、下载与工具本身都放在这个包里，而不是各自的能力缝（capability seam）。当出现第三个来源，或出现不是工具的消费者时，就应该把提供方拆出去。
- **开头文字靠抓取。** 卡片文字用模式规则从页面段落中读取，而不是用正文提取（readability）解析器，因此少见的页面仍可能以规则未覆盖的杂项开头。
- **横竖由读者的浏览器判定。** 工具存储文件本身；客户端依据加载后的图片决定每个图块的形状，因此本包不参与一行图片的排布。
- **暂无测试套件。** 该包是在真实会话中跑通的；其 spec，包括 wire 边界解析以及体积与超时边界，仍待补写。
