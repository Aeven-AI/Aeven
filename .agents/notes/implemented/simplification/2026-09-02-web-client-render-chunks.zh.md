# Agent Note: Web 客户端渲染分块

Status: implemented

[English](2026-09-02-web-client-render-chunks.md) | 中文

## 问题

Web 外壳的 Vite 图静态导入 ui-primitives，因此 KaTeX、shiki 与 markdown 解析管线共享一个 `vendor` chunk，每个会话都在首帧前下载它。Mermaid 已是 diagram 插件中的动态 `import()`，但 MarkdownText 设置了 HyperMarkdown 的 `preload` 标志，会在每次 markdown 挂载时拉取该引擎，而且异步 mermaid 文件使用 rollup 默认名称，与启动资源混在一起。

## 决策

`apps/web/vite.config.ts` 产出三个无 React 的渲染族 chunk——`katex`、`shiki`（外加三个启动 grammar）与 `mdast`（micromark/mdast）——而不再是一个 vendor 文件。解析管线 chunk 命名为 `mdast`，以免与懒加载的 `@shikijs/langs/markdown` grammar 冲突。Mermaid 不列入 `manualChunks`，因此 rollup 继续把它的 diagram engine 作为异步 chunk；`chunkFileNames` 将它们命名为 `m-core-*` 与 `m-asset-*`，与 Aeven client 布局一致。懒加载的 `@shikijs/langs` grammar 仍在 `assets/langs/` 下。MarkdownText 不设置 `preload`；插件的 `load()` 在真正渲染 diagram fence 时才开始 mermaid 拉取。

## 验证

构建产物测试要求存在 `katex-`、`shiki-` 与 `mdast-` 启动文件、至少一个 `m-core-` 与 `m-asset-` 文件、`index.html` 中无 `vendor-` 标记，且不对 mermaid 或懒加载 grammar chunk 做 modulepreload。Markdown 单元测试仍把 mermaid fence 渲染为 diagram 容器。

## 考虑过的替代方案

**继续使用单一 vendor chunk。** 这样 KaTeX 或 shiki 升级会重哈希整份渲染 payload，而且 Vite 的 500 kB 警告会打在每个会话都要下载的启动文件上。

**把 mermaid 放进 `manualChunks`。** rollup 会把动态 `import()` 折回具名启动 chunk，使 mermaid 回到初始图。

**在 MarkdownText 上保留 `preload`。** 即使该轮没有 diagram，每条 assistant 消息也会开始 mermaid 下载。

## 后果

启动会把 katex、shiki 与 mdast 下载为各自带 hash 的文件，因此各族可独立缓存。没有 mermaid fence 的会话永远不会拉取 `m-core` / `m-asset`。index chunk 仍是 workspace 的 React/Cordis/ui-primitives payload，仍可能超过 Vite 的 500 kB 提示；那是外壳本身，不是漏拆 mermaid。
