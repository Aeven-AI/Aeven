---
description: "由随包 LibreOffice 引擎支持的 Office 文档读取器：旧版 Word、Excel、PowerPoint，以及内置读取器无法读取的 Office 文件。"
kind: "package-reference"
---

# @aeven/document-extract-office

[English](README.md) | 中文

## 概述

`avn-document-extract-office` 在 `ctx.documentExtract` 上以优先级 10 注册提供者 `office`，因此它在内置读取器之后运行，读取它们读不了的内容：旧版 Word、Excel 与 PowerPoint 文件，以及内置读取未返回文本的 Office 文件。文字处理格式导出为 UTF-8 文本，电子表格与演示文稿导出为 PDF，再交给注册表的 PDF 读取器。引擎是 `@deepseek-ai/libreoffice-kit` 为宿主平台安装的 LibreOffice 构建；每次转换都在引擎进程中运行，文档位于私有临时目录中，安装中缺少该引擎时插件加载失败。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

把它与服务一起挂载：该插件在 `ctx.documentExtract` 上注册 `office` 提供者。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `120000` | 单次转换离开队列后开始计时的墙钟上限 |
| `concurrency` | `1` | 同时进行的转换数；每次转换运行自己的引擎进程 |

<a id="model-experience"></a>
## 模型体验

### 提取出的文档文本

#### 模型看到的内容

本包不注册任何 prompt、工具或 Session 事件，并给出 `method: "office"` 的结果。它通过 `ctx.documentExtract` 返回的文本由接受该上传的消费方存为该上传文件的文本，因此模型把它作为该文件的内容读取；引擎导出的文本保留文档的段落分隔，连续空行会被压缩。

#### Token 影响

每份文档由注册表的 `maxTextChars` 限定上限；电子表格或演示文稿转换出的 PDF 由另一个提供者读取，并在同一预算下裁剪。

#### KV Cache 影响

仅追加：文本随携带该上传文件的消息进入请求。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **缺少平台引擎的宿主会加载失败** —— `apply` 会等待引擎工厂，因此该插件报告加载失败，而不是降级到其他读取器；该 kit 把引擎作为普通依赖提供，运行时不下载任何内容。
- **每次转换一个引擎进程** —— 转换在私有临时目录中写入输入文件并读回输出文件，因此 `concurrency` 大于 1 会成倍增加引擎进程与临时目录。
- **无不变式伴生入口** —— 不发布运行时不变式伴生入口，因为每次转换都发生在独立的引擎进程中，并通过该临时目录中的文件返回，本包不持有同进程关系；它唯一持久的关系是引擎工厂的释放，注册为单个 `ctx.effect`，而提供者的行为由 `tests/office.spec.ts` 断言。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
