# Agent Note: Session 激活时从 Chat 的实时末尾开始

Status: implemented

[English](2026-09-08-session-activation-chat-tail.md) | 中文

## 问题

Chat 会按 Session 保存语义阅读位置，使用户切换到其他视图再返回 Chat 时仍保留原位置。同一个 Map 也会跨越 A → B → A 的 Session 切换。旧位置因此可能使再次访问的 transcript 脱离实时末尾，并且即使读者离开两个 Session 时都位于末尾，界面仍显示「回到底部」。内容搜索导航具有不同目标：它必须显示索引命中的事件，而不是末尾。

## 决定

Chat 插件观察 Session Controller 的当前选择。所选 Session 身份变化时，如果 `uiConversation` 尚未持有该 Session 的待处理事件导航请求，插件就删除目标 Session 保存的 Chat 位置。因此重新挂载的 Chat 视图读不到已保存位置，并取得实时末尾的跟随归属；在常驻外壳的 composer 稳定后，它还会在下一动画帧再次应用末尾位置。内容搜索会先发布事件请求再选择 Session，所以 Chat 会保留该导航，并在事件行提交后准确落到该事件，且不会安排末尾校正。同一 Session 内的视图切换不会改变所选身份，并继续恢复[工具行与 Inspect 决定](../feature/2026-07-30-web-tool-row-unified-expand-and-inspect.zh.md)定义的语义锚点。

## 考虑过的替代方案

**每次重新挂载都删除 Chat 滚动记忆。** 否决，因为在同一 Session 内从 Chat 切换到 Trajectory 再返回时必须保留读者位置。

**仅在侧边栏行点击处理器中清除位置。** 否决，因为地址导航、浏览器后退与前进、面包屑和其他 Session 选择器都能到达同一个 Session Controller 状态，却不共享该处理器。

**每次 Session 切换都发送到末尾。** 否决，因为内容搜索结果拥有准确的持久事件目标；末尾导航会丢弃读者选择的结果。

## 后果

普通 Session 导航会从 Chat 最新加载内容开始，包括再次访问最后一次滚动采样仍保留旧锚点的 Session。内容搜索导航会保留其事件目标。滚动记忆仅用于不改变所选 Session 的重新挂载，并且该策略依赖内容搜索先调用 `navigateToEvent` 再调用 `sessions.open`。
