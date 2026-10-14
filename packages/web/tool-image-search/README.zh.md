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

### `find_images` 工具 schema

#### 模型看到什么

本包在生成的[工具目录](../../../docs/tool-catalog.zh.md#aeventool-image-search)中注册的唯一条目：名称 `find_images`、写明何时该用它以及绝不能描述尚未展示的照片的说明，以及六个参数——`query`、`urls`、`count`、`layout`、`language` 与 `translations`（每个结果位置一项，含 `title` 与 `summary`）。结果由两个文本块，以及按展示顺序排列的、作为 image 块的已存图片组成。

#### Token 影响

固定：在组合了本包的会话中，每个请求都有一个工具定义，与任何调用无关。结果额外带来的只有它自己的文本——一行照片至多 `count` 行，卡片则每篇具名文章一行。

#### KV Cache 影响

在可见工具集不变时保持前缀稳定；添加或移除本包、或更改工具名都会重建该列表。结果追加在用户消息之后。

### 结果文本

#### 模型看到什么

一次调用的第一个文本块说明展示了多少内容，告诉模型这些图片已经展示、不要再把它们写成 markdown，并把每个条目列成一行编号行，给出标题、来源页与许可；一行照片与卡片的措辞不同；什么都没找到时，则以下方最后一个块中的一句作答。第二个文本块以 JSON 携带同样的条目，供客户端的卡片视图使用；图片块紧随其后。

##### 逐字：一行照片的结果

```markdown
Found <N> photograph(s) for "<query>".
They are already displayed to the user as one row of images. Do not write them again as markdown images or links.
Cite each one where you use it:
1. <title> — <source> (<license>)
```

##### 逐字：卡片的结果

```markdown
Made <N> card(s) for <query or the stories>.
They are already displayed to the user, one card per story with its image, headline, opening text and source, each linking to its article. Do not list these stories again as links or headlines; write only what the cards do not say.
The cards, in order:
1. <title> — <source> (<license>)
```

##### 逐字：一行照片未找到结果

```markdown
No photographs of "<query>" could be found. Answer without images, and say where you looked.
```

##### 逐字：卡片未找到结果

```markdown
No cards could be made for <query>: none of the pages could be read or published an image. Present the stories in prose instead.
```

#### Token 影响

只有结果自身的文本：上述框架是固定的，每个条目的编号行在照片模式下受 `count` 限制（默认 `3`，最多 `6`），在卡片模式下受具名文章数限制（最多 `10`）。JSON 块重复同样的条目。图片的开销属于模型路由自身的图像计费，与本包无关。

#### KV Cache 影响

仅追加：结果接在用户消息之后，不改变更早的请求。

### 翻译调用

#### 模型看到什么

当一次调用指定了 `language`、未提供 `translations`，并且至少存下一张图片时，本包会在会话自身的路由上、在会话之外发出一个辅助请求：其系统文本固定，唯一的 user 消息以 JSON 携带语言与各条目的标题和开头文字。

##### 逐字：翻译系统文本

```markdown
You translate news items for a reader who reads one language. Reply with JSON only, no prose and no code fence: {"items":[{"title":"...","summary":"..."}]}, in the same order and count as the input. Translate every item into the named language, keeping names, numbers, product names and quotations intact. An item already in that language comes back unchanged, character for character.
```

##### 逐字：user 消息框架

```markdown
{"language":"<the conversation's language>","items":[{"title":"<headline>","summary":"<opening text>"}]}
```

#### Token 影响

每次翻译调用一个辅助请求，独立于会话自身的请求：输入是各条目的标题与开头文字，输出受 `maxTokens` `1600` 限制，并在配置的 `translationTimeoutMs`（`30000`）内运行，该值也会加到工具自身的期限上。失败或超时则保留原文。

#### KV Cache 影响

对会话无影响：该请求在会话路由上只发送一次，带有自己固定的系统文本，因此既不读取也不延长会话可复用的前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **单包，而非能力缝。** Commons 搜索、页面抓取、下载与工具本身都放在这个包里，而不是各自的能力缝（capability seam）。当出现第三个来源，或出现不是工具的消费者时，就应该把提供方拆出去。
- **开头文字靠抓取。** 卡片文字用模式规则从页面段落中读取，而不是用正文提取（readability）解析器，因此少见的页面仍可能以规则未覆盖的杂项开头。
- **横竖由读者的浏览器判定。** 工具存储文件本身；客户端依据加载后的图片决定每个图块的形状，因此本包不参与一行图片的排布。
- **暂无测试套件。** 该包是在真实会话中跑通的；其 spec，包括 wire 边界解析以及体积与超时边界，仍待补写。
- **无 invariant 伴随模块**——不发布运行时 invariant 伴随模块，因为它的每一项观测都来自 Commons 响应、web 搜索或抓取到的页面，而存储的图片属于 `ctx.attachments`，因此本包不拥有任何两个观测者可能产生分歧的关系。
