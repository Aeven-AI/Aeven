---
description: "内置文档读取器：PDF、Office Open XML、OpenDocument、Pages、Keynote、Numbers、RTF、EPUB、HTML 与文本格式，在工作线程中读取。"
kind: "package-reference"
---

# @aeven/document-extract-js

[English](README.md) | 中文

## 概述

`avn-document-extract-js` 在 `ctx.documentExtract` 上以优先级 0 注册提供者 `js`，因此它在 OCR 与 Office 提供者被询问之前读取文档。它用 JavaScript 与 WebAssembly 库覆盖 PDF、Office Open XML、OpenDocument、iWork、RTF、EPUB、HTML 与文本格式——PDF 读取器随 `vendor/` 一同提供——每份文档都在自己的 worker 线程中读取，并受墙钟与堆内存限制，因此这里不需要原生二进制文件，该提供者原样随 Desktop seed 发布。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

把它与服务一起挂载：该插件在 `ctx.documentExtract` 上注册 `js` 提供者。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `60000` | 单份文档的墙钟上限，超过后终止其 worker |
| `maxWorkerHeapMb` | `512` | 单个 worker 的老生代堆上限 |
| `concurrency` | `2` | 同时运行的提取 worker 数 |

<a id="model-experience"></a>
## 模型体验

### 提取出的文档文本

#### 模型看到的内容

本包不注册任何 prompt、工具或 Session 事件，并给出 `method: "native"` 的结果。它通过 `ctx.documentExtract` 返回的文本由接受该上传的消费方存为该上传文件的文本，因此模型把它作为该文件的内容读取；PDF 的提取文本是其各部分以空行连接的结果，纯图像 PDF 不产出文本，注册表因此回退到 OCR 提供者。

#### Token 影响

每份文档由注册表的 `maxTextChars` 限定上限；本包在该文本之外不追加内容。

#### KV Cache 影响

仅追加：文本随携带该上传文件的消息进入请求。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **每份文档都会启动一个 worker** —— 读取器把字节复制进 worker，并为每份文档付出一次线程启动，因此大量小体积上传的开销高于其文本本身；`concurrency` 限定同时运行的数量。
- **PDF 文本来自文件自身携带的文本层** —— 扫描版 PDF 没有文本层，这正是 OCR 提供者存在的原因；本读取器从不把页面渲染成图像。
- **无不变式伴生入口** —— 不发布运行时不变式伴生入口，因为每份文档都在自己的 worker 线程中读取，而它返回的那条唯一回复由 `@aeven/document-extract/execution` 处理，本包没有可供比较的同进程事件序列；它向 `ctx.documentExtract` 贡献一个提供者注册与一个 `DocumentExtractionLimiter`。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
