---
description: "文档文本提取服务（ctx.documentExtract）：提供者注册、格式路由、文本预算与失败码。"
kind: "package-reference"
---

# @aeven/document-extract

[English](README.md) | 中文

## 概述

`@aeven/document-extract` 注册 `ctx.documentExtract`，即所有文档消费方共享的提供者注册表。提供者以自己的 id、所读格式与优先级注册；`accepted()` 在读取上传内容之前报告这些格式的并集，`extract()` 把字节路由给第一个声明该扩展名或媒体类型的提供者，在提供者失败或未返回文本时继续尝试下一个，最后将结果裁剪到 `maxTextChars` 并给出产出该结果的提供者。失败是 `DocumentExtractError`，码为 `UNSUPPORTED_FORMAT` 或 `EXTRACTION_FAILED`。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在宿主编排中挂载该服务；会话上传由 `@aeven/api-session-controller` 读取它。提供者是独立的包——`@aeven/document-extract-js`、`@aeven/document-extract-ocr` 与 `@aeven/document-extract-office`——各自以自己的 id 注册。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxTextChars` | `400000` | 单个文档保留的字符数；更长的文本会被裁剪并标记 `truncated` |

<a id="model-experience"></a>
## 模型体验

### 提取出的文档文本

#### 模型看到的内容

本包不注册任何 prompt、工具或 Session 事件。`extract()` 返回的文本由接受该上传的消费方存为该上传文件自身的文本——会话上传由 `@aeven/api-session-controller` 完成——因此模型把它作为该文件的内容读取，`truncated` 标记被裁剪到 `maxTextChars` 的结果。

#### Token 影响

每份文档由 `maxTextChars` 限定上限，且只在携带该上传文件的请求中付费。

#### KV Cache 影响

仅追加：提取出的文本随携带该文件的消息进入请求，因此未变化的对话保持其前缀。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **声明失败只被报告，不被归因** —— 当所有声明该格式的提供者都失败时，注册表抛出一个 `EXTRACTION_FAILED`，并把首个失败作为 `cause`，因此调用方无法判断是哪个提供者出错。
- **无不变式伴生入口** —— 不发布运行时不变式伴生入口，因为提供者表只有一个写入者且没有事件流：`register` 拒绝已被占用的 id，其 disposer 只移除自己添加的提供者，而 `extract` 读取的是同一张表，因此监听器只会重复它声称要验证的操作；格式路由、文本预算与提供者回退由 `tests/registry.spec.ts` 断言。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
