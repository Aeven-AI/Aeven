# Agent Note: Tool card 改用 highlight.js

Status: implemented

[English](2026-09-02-highlight-js-tool-cards.md) | 中文

## 问题

Assistant markdown fence 已通过 HyperMarkdown 的 highlight.js 插件高亮，而 `CodeBlock` 与 `ReadBlock` 使用第二套引擎（shiki），Vite 会把它作为约 394 kB 的启动 chunk 加上一棵懒加载 grammar 树进行 modulepreload。首帧因此为两套高亮器付费。

## 决策

`packages/client/ui-primitives/src/markdown/highlight.ts` 使用 `highlight.js/lib/core`，启动时注册四种语言（javascript、typescript、bash、json）。read card 的更广语言集在首次使用时通过 `highlight.js/lib/languages/*` 加载。`CodeBlock` 与 `ReadBlock` 消费该模块；MarkdownText 继续使用 HyperMarkdown 的 highlight.js 插件（rehype-highlight → lowlight/common）。ui-theme 的 `highlight.css` 用原先 shiki 表的 token 调色板为 `hljs-*` class 着色。Vite 把 highlight.js 核心、lowlight 与 lowlight/common grammar 产出为 `hljs` 启动 chunk；CodeBlock 的动态语言 import 解析到同一文件。

## 验证

单元测试覆盖别名解析、懒加载语言、视口激活、流式行保留，以及 ReadBlock 按行 runs。构建产物测试要求存在 `hljs-` 启动文件、禁止 `shiki-` 启动文件，并仍要求 katex、mdast 与按需 mermaid chunk。流式 fence 的 Chromium 场景断言 HyperMarkdown fence 中的 `code.hljs`。

## 考虑过的替代方案

**Tool card 继续使用 shiki。** 这样可保留增量 TextMate 状态与 `--shiki-*` 内联颜色，代价是每次启动都带第二套引擎。

**让 tool card 走 HyperMarkdown 的 rehype 插件。** 该插件通过 hast 树高亮一行 fence，无法为带 gutter 的 read card 提供按行 runs。

## 后果

启动不再下载 shiki。Markdown fence 与 tool card 共用 highlight.js。流式 `CodeBlock` 会重新高亮已累积文本（无 TextMate grammar 状态），并在新高亮匹配时复用已完成行的 span 数组。未知语言保持纯文本。
