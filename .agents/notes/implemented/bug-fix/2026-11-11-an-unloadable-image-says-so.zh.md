# Agent Note: 无法加载的图片会说明原因

Status: implemented

[English](2026-11-11-an-unloadable-image-says-so.md) | 中文

## Problem

Host 无法转成 URL 的 markdown 图片只渲染成替代文本，别无其他。只写了 `![](path)` 的作者则什么都没留下：段落是空的，没有标记、没有源、没有报错。读者以为回复完整，模型也这么以为 —— 这正是 #630 在整整一个会话里对双方都不可见的原因：那张图一直在工作区里。

引擎的渲染器本来就有这样一个静默分支：`MarkdownImage` 对未解析的源返回 `span.markdown-image-alt`，于是读者在本该有图片的地方看到一段文字。携带该修复的分支上，工作区源现已可解析；工作区之外的源、策略拒绝的协议、过期的路径仍然解析为空，而每一种都恰恰是需要告知读者的情形。

## Decision

`MarkdownImage` 把未解析的源画成一个可见块，带上宿主提供的文案（`imageUnavailableLabel`）与它未能加载的源；作者写了替代文本时就一并放在旁边。`title` 承载完整源，供过长的路径使用。

引擎不拥有任何语言，因此该文案是 `RendererOptions` 的字段：缺失时保留旧的仅替代文本渲染，而不是让引擎自己造英文。`ui-primitives` 的 `MarkdownLabels` 新增必填的 `imageUnavailable`，这与该包对其余所有界面文案的规则一致 —— 省略即类型检查失败，各消费方把自己的 `t` 座位映射进来。文案位于 en、zh、es 字典的 `markdown.imageUnavailable`；Chat 的标签工厂与 Integrations 页面里的三处 `MarkdownText` 都会提供。

## Alternatives considered

**让引擎自己拥有文案。** 那样只需一个字符串，不必让每个消费方都加必填属性；但引擎按契约是 Cordis-free、locale-free 的，`verify-client-ui-i18n` 的存在正是为了把产品文案挡在渲染器之外。硬编码的英文标签还会是中文回复里唯一的英文句子。

**只在 `title` 和 `aria-label` 里写出源。** 那样视觉输出不变 —— 而这正是缺陷：只在悬停时出现的标记，在截图里、打印稿上、以及从不悬停的读者眼里都不存在。

**把失败作为工具结果或会话事件报告给模型。** 图片是用 markdown 写的，不经过工具，没有调用可供回应；而且读者的问题是当时什么都没看到，任何模型可见的信号都解决不了。

## Consequences

加载失败的图片现在会用读者的语言写出失败的源，两个 Host 以及 `MarkdownText` 渲染的其它地方（包括 Integrations 页面里的技能说明）都如此。有意的纯替代文本图片（`![](…)` 且 URL 可加载）不变：只有在解析为空时才出现该状态。

该块只有结构与文案：没有重试控件，也不告诉读者源为何失败（工作区之外的路径与已删除的文件看起来一样）。两者都推迟；写出源本身让任何一种都可诊断。

## Verification

`packages/client/hypermarkdown/tests/ui/image-unavailable.client.spec.tsx` 分别在有/无标签、有/无替代文本的情形下渲染未解析的源，断言标签、源、替代文本与 `title`。`packages/client/ui-primitives/tests/markdown.client.spec.tsx` 通过 `MarkdownText` 覆盖同一状态，含无法解析源的 DOM parity 夹具已重新录制。`pnpm run test:gui` 与类型检查通过。
