# Agent Note: 被拒绝和加载失败的图片同样会说明

Status: implemented

[English](2026-11-11-refused-and-failed-images-say-so.md) | 中文

## Problem

[无法加载的图片会说明原因](2026-11-11-an-unloadable-image-says-so.zh.md)只在 host 的解析器返回不了 URL 时才绘制可见块。[工作区图片](2026-11-11-markdown-images-load-through-the-workspace-route.zh.md)让 assistant Markdown 中的每个本地源都有了 URL 之后，读者实际遇到的失败（#630）就再也走不到这个分支：

- 错误或已删除的工作区路径解析到 `/api/workspace-file`，路由返回 404，而 `<img>` 没有 `onError`：读者只看到一个空图片框。
- 在托管 Host 上，工作区之外的绝对路径仍解析到 `/api/file`，而托管配置不挂载该路由：同样是空框。
- 被链接安全规则拒绝的源（`http:`、`//`、不允许的协议）在 rehype 阶段、图片组件运行之前就被替换成替代文本：只剩纯文本，作者没写替代文本时则什么都没有。

## Decision

`MarkdownImage` 在这三种情况下都显示不可用块。它记住加载失败的 URL，并为该 URL 绘制该块；之后解析器修订给出另一个 URL 时会重新尝试。`rehypeLinkSafety` 不再把被拒绝的图片拼接成文本节点：它去掉 `src`，把作者写下的源保留为 `data-blocked-src`，由图片组件在块中显示。引擎构建的每个组件映射（顶层、缓存块、表格与列表单元格）都通过 `MarkdownImage` 绘制 `img`，因此没有不带 `src` 的 `<img>` 会到达页面。

有意为之的情况保持不变：未提供 `imageUnavailableLabel` 的 host 仍只得到替代文本，host 通过 `imageVisible` 隐藏的图片仍保持静默。

## Alternatives considered

**让客户端知道 Host 提供哪些文件路由**，使托管客户端永远不构建 `/api/file` URL。这需要新的远程方法、一次客户端请求，以及接入每个 `MarkdownText` 解析器的管线，而它只省掉一次 404 请求。加载失败分支已经为该源显示正确状态，同一分支还覆盖了已删除的文件，这是任何能力标志都无法预知的。

## Consequences

每张 Markdown 图片要么加载成功，要么用读者的语言说出它的源。该块仍不说明源失败的原因，也不提供重试；暂时性的网络失败会一直停留在不可用状态，直到解析器改变。
