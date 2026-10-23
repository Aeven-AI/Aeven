---
description: "document 包组：ctx.documentExtract 注册表，以及把上传的文档或录制的片段转成模型可读文本的读取器。"
kind: "package-group"
---

# document/ — 文档文本提取

[English](README.md) | 中文

## 概述

document 组把上传的文档或录制的片段转成模型可读的文本。一次上传先问 `ctx.documentExtract` 哪些读取器认领该文件，然后按优先级依次运行认领的读取器，直到其中一个返回文本，该文本随附件一起进入对话。部署新增一种格式只需挂载另一个提供方，不必改动上传路径。该家族由五个包组成：注册表、内置的 JavaScript 读取器、基于 LibreOffice 的 Office 读取器、用于扫描版 PDF 的 OCR 读取器，以及视频读取器。该组只负责提取；上传路由限定文件类型与大小。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

注册表把每份文档路由到一个读取器；其余每个包按固定优先级向它注册一个读取器。

| 包 | 职责 |
|---|---|
| [`document-extract/`](document-extract/README.zh.md) | 持有 `ctx.documentExtract`：提供方注册、按优先级路由、文本预算与失败码 |
| [`document-extract-js/`](document-extract-js/README.zh.md) | 在工作线程中读取 PDF、Office Open XML、OpenDocument、iWork、RTF、EPUB、HTML 与文本格式，优先级为 0 |
| [`document-extract-office/`](document-extract-office/README.zh.md) | 通过随附的 LibreOffice 引擎读取旧版 Word、Excel 与 PowerPoint，优先级为 10 |
| [`document-extract-ocr/`](document-extract-ocr/README.zh.md) | 在内置读取器没有返回文本之后，用 pdf.js 与 Tesseract 识别扫描版 PDF，优先级为 20 |
| [`document-extract-video/`](document-extract-video/README.zh.md) | 依据宿主 `ffprobe` 的输出描述上传或录制的片段，优先级为 10 |

<a id="related-documentation"></a>
## 相关文档

- [文档提取子系统](../../docs/subsystems/document.zh.md)——`ctx.documentExtract` 的各项操作、格式路由与失败码。
- [会话控制器](../api/session-controller/README.zh.md)——接受文件、把提取文本存入附件并限定类型与大小的上传路由。
- [附件存储](../attachment/attachment/README.zh.md)——把提取文本带入提示词的持久引用。
- [能力 seam](../../docs/glossary.zh.md#capability-seam)——本组所依据的 Service Definition、Service Provider 与 Consumer 角色。

<a id="dev-note"></a>

<a id="开发备注"></a>

## 开发备注

无。
