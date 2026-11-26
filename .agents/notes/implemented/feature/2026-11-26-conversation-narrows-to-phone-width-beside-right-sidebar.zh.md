# Agent Note：右侧栏旁的对话收窄到手机宽度

Status: implemented

[English](2026-11-26-conversation-narrows-to-phone-width-beside-right-sidebar.md) | 中文

## 问题

右侧栏（[`@aeven/client-ui-sidebar-right`](../../../../packages/client/ui-sidebar-right/README.zh.md)）只要旁边的对话会低于 640px（`CENTER_MIN`），就改为覆盖在对话之上，而它的拖动在窗口宽度的 70% 处停止。在左侧栏打开的 1280px 窗口上，600px 的面板就已经盖住对话，读者无法在宽面板旁保持对话可读。按行计算卡片数的页面（Inspiration 与 Bots）从窗口取断点，因此收窄的对话仍保留桌面行数。

## 决定

- **手机宽度下限。** `columns.ts` 中的 `RIGHTBAR_CONVERSATION_MIN`（375px）同时取代 640px 覆盖下限与 70% 上限。只要面板下限宽度能为对话留出 375px，面板就占一栏；拖动在对话到达 375px 处停止。`AppFrame` 从该上限中减去左侧栏与 details 栏，左侧栏的实际绘制宽度读自 `--dsw-aeven-sidebar-width` 令牌，因为 ui-sidebar 按令牌而不是按存储的偏好绘制。
- **页面自有断点。** Inspiration 与 Bots 用 `useNarrowerThan`（从 `TurnRail.tsx` 移到 `@aeven/client-ui-primitives`）测量自身内容宽度，并标记 `data-cards` 或 `data-phone`。每个阈值是旧的窗口断点减去每侧页面内边距，因此全宽页面仍在原处断行。
- **两侧间距。** 收窄的对话保留 24px 页面内边距；只有手机窗口使用 16px。

## 考虑过的替代方案

**CSS 容器查询**被否决：它需要 Safari 16.0，低于客户端的 iOS/Safari 14.5 基线，`verify-css-baseline` 会拒绝它。在对话栏上建立容器早已因侧栏滑动期间的样式重算成本被否决（`ConversationRoot.module.css`）。**框架级宽度属性**会要求每个页面针对同一个共享值重述断点；而各页面拥有不同的阈值。

## 影响

转录内容自身的手机规则（例如 hypermarkdown 的表格与代码块规则）仍跟随窗口，因此面板旁 375px 的对话保留它们的桌面形态。`CENTER_MIN` 现在只服务于 `computeColumns`，而生产代码不调用它。
