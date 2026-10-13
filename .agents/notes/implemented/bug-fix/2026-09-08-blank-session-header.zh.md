# Agent Note: 空白 Session 保留会话标题栏

Status: implemented

[English](2026-09-08-blank-session-header.md) | 中文

## 问题

`ConversationSessionHeader` 会在已选 Session 仍为空白时隐藏全部标题栏 chrome。因此，新建 Session 会显示 Hero，却不显示标题、标题栏 action，尽管严格 Session entry 及其贡献已经可用。只有首条提示词让对话离开 blank phase 后，标题栏才会出现。

## 决策

每个已选 Session 都会渲染 `conversation.session.header`，包括 Hero 上的 blank Session。无 Session 状态仍然没有标题栏，因为 optional-Session root 要等 Session 存在后才会分发该严格 entry。blank 状态只抑制 `conversation.view`，不会抑制导航或 Session action。标题栏仍位于对话主体及其内容加载器之外。

这只取代[固定标题栏与 sticky composer 决定](2026-07-29-sticky-composer-conversation-scroll.zh.md)中关于 blank 标题栏可见性的条款。该笔记仍拥有标题栏位于根滚动容器之上、composer 位于其内部的布局决定。

## 验证

`ConversationRoot` skeleton 测试挂载 blank Session，要求当前标题可访问，并要求两个标题栏贡献区域在 Hero 与可用 composer 仍存在时完成分发。活跃 Session 用例继续证明标题栏位于滚动容器之外。

## 考虑过的替代方案

**继续隐藏 blank 标题栏。** 这会保留不间断的 Hero 画布，但也会在已选 Session 刚出现时移除 Session 级导航与 action。

**只在 Hero 上渲染选定的标题栏 action。** 这能保留个别控件，但会建立第二条标题栏组合路径，其标题、lineage、间距和无障碍行为可能与活跃对话分歧。

**把标题栏移到 optional-Session root。** 标题栏的数据与贡献属于严格 Session 状态。给无 Session shell 增加一条平行的占位标题栏会削弱该作用域保证，却无法进一步帮助已选 blank Session。

## 后果

新 Session 会显示与活跃对话相同的 56px 导航 chrome，因此标题以及每个已注册的 Session action 在首条提示词之前即可用。Hero 仍是 blank Session 的主体，并且在 Session 离开该 phase 前不会激活任何 target View。
