---
description: "扫描版 PDF 的 OCR 读取器：用 pdf.js 渲染页面，并在工作线程中用 Tesseract 识别，英语数据随包提供。"
kind: "package-reference"
---

# @aeven/document-extract-ocr

[English](README.md) | 中文

## 概述

`avn-document-extract-ocr` 在 `ctx.documentExtract` 上以优先级 20 注册提供者 `ocr`，因此它只在内置读取器未返回文本时声明 PDF——即扫描版 PDF。页面用 pdf.js 渲染到预构建的 canvas 上，并由 worker 线程中的 Tesseract（WebAssembly）识别，受墙钟与堆内存限制；英语语言数据以及 pdf.js 的 wasm 与字体文件都是安装目录中解析到的 npm 依赖，运行时不下载任何内容。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

把它与服务一起挂载：该插件在 `ctx.documentExtract` 上注册 `ocr` 提供者。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxPages` | `30` | 最多识别的页数，从第一页开始 |
| `scale` | `2` | 相对 72 DPI 的渲染缩放；2 表示按 144 DPI 渲染 |
| `timeoutMs` | `300000` | 单份文档的墙钟上限，超过后终止其 worker |
| `maxWorkerHeapMb` | `1024` | 单个 worker 的老生代堆上限 |
| `concurrency` | `1` | 同时运行的 OCR worker 数 |
| `recognizers` | `4` | 一份文档的各页分配到的 Tesseract recognizer 数 |

<a id="model-experience"></a>
## 模型体验

### 识别出的文档文本

#### 模型看到的内容

本包不注册任何 prompt、工具或 Session 事件，并给出 `method: "ocr"` 的结果。识别出的文本只通过接受该上传的消费方到达模型，由其存为该文件的文本；识别是对像素的猜测，因此相比带文本层的 PDF，文本可能出现误识别的字符。

#### Token 影响

每份文档由注册表的 `maxTextChars` 与 `maxPages` 限定上限，先触及者生效。

#### KV Cache 影响

仅追加：文本随携带该上传文件的消息进入请求。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **仅支持英语** —— 随包提供的识别器数据是 `eng`，因此其他语言的扫描文档会按英语识别，或者完全无法识别。
- **识别不是提取** —— 结果是对渲染后像素的猜测；没有任何记录说明某一行来自哪一页或哪个区域，`pages` 报告的是识别了多少页，而不是在哪里找到了文本。
- **无不变式伴生入口** —— 不发布运行时不变式伴生入口，因为页面渲染与识别都发生在 worker 线程内，时间与堆内存限制由 `@aeven/document-extract/execution` 实施，因此不存在可供监听器比较的同进程关系；本包只贡献一个提供者注册。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
