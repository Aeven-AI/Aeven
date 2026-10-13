# Agent Note：HyperMarkdown 负责流式定稿

Status: implemented

[English](2026-09-08-hypermarkdown-streaming-finalization.md) | 中文

## 问题

`MarkdownText` 在回复流式输出时启用了 HyperMarkdown 的词语动画，但回复一结束就用一次性的 settled 解析替换流式渲染。该替换会在 CSS 动画完成前移除最后一批动画 span，因此最后几个词无法完成淡入。若由适配器延迟替换，就会重复定义渲染器的动画时长，并在渲染器调整时序后失效。

Aeven 客户端让同一个流式 HyperMarkdown 实例保持挂载，并通过命令式渲染器 API 将其定稿。HyperMarkdown 通过内部的外部 store hook 发布最终渲染；宿主不会安排稍后的替换。

## 决定

`MarkdownText` 遵循渲染器生命周期。它继续把累积源文本转换为增量，启用 `animation`，并在 `streaming` 变为 false 时调用 `write(finalDelta, true)`。HyperMarkdown 的外部 store 订阅发布定稿渲染，而适配器让该渲染保持挂载。若终止时源文本被替换，适配器会重置 store，并以启用 `finalize` 的方式写入替代内容，使其获得相同的动画行为。

直接以 settled 状态挂载的回复仍使用 `setMarkdown`。只有从实时流式状态切换到 settled 状态时才保留流式表示。

本决定仅取代 [HyperMarkdown 引擎记录](../architecture/2026-08-28-web-markdown-hypermarkdown-engine.zh.md)中的定稿选择。该记录关于引擎归属、安全策略与累积字符串适配器的决定仍然有效。

## 测试

增量客户端测试会让散文、fence、表格、列表及混合 Markdown 经历流式定稿，覆盖中途挂载、源文本替换与 React Strict Mode，并断言动画节点在 `animationend` 事件和内容不变的 settled 重渲染后仍保持挂载。DOM fixture 会固定流式挂载中渲染器的动画标记与词语包装。构建后的 Web 客户端还会通过真实模型回复进行验证，确认最终动画节点到达 `animationend` 后仍留在 DOM 中。

## 考虑过的替代方案

**立即执行 settled 解析。** 被否决，因为它会在最后一次淡入期间移除渲染器拥有的动画节点。

**在超时后执行 settled 解析。** 被否决，因为适配器将硬编码 HyperMarkdown 所拥有的时序，并可能与其 CSS 偏离。

**等待动画 DOM 事件后再执行 settled 解析。** 被否决，因为渲染器没有通过适配器 API 暴露动画根节点，而观察生成的标记会让宿主耦合到私有 DOM 细节。

## 影响

最后一个词的淡入会通过与 Aeven 参考客户端相同的 hook 和 store 生命周期完成，不使用宿主计时器，也不执行第二次解析。已定稿的实时回复会保留 HyperMarkdown 的动画包装。流式 fence 与表格仍可能受网络分片方式影响；该取舍接受渲染器的流式表示，使其生命周期不再被宿主中断。
