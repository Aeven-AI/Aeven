# Agent Note: 未选择 Workspace 的编辑器卡片不再自带描边

Status: implemented

[English](2026-09-12-no-workspace-composer-ring.md) | 中文

## 问题

未选择 Workspace 时，输入卡片静止状态带有一圈虚线 l4 描边（以 `::after` 的 SVG dash ring 绘制），用来把卡片标记为 Workspace 选择器的入口。但读者无需请求选择器也会进入这一状态：归档当前选中的 Session 后，既没有 Session 也没有 workspace，常驻编辑器便自行落到入口姿态。此时这圈虚线读起来像是输入区自身的装饰——一个空输入框上的焦点框或拖放框——而不是可点击的入口，何况这一时刻并没有待定的选择。

## 决策

`packages/client/ui-conversation/src/client/input/InputBar.module.css` 让 `.cardWorkspaceTrigger` 保持它在其他情况下本就应有的平面外观：透明的 elevation 描边与手型光标，不再有描边规则，也没有 hover 变色。卡片仍然承载整个胶囊的点击，只读草稿仍然可用 Enter 或 Space 激活选择器，`.cardWorkspaceTrigger :disabled` 仍然放行工具栏上的指针事件，因此点击目标与可访问性契约不变。卡片上方的 Workspace chip 继续承担可见的邀请，占位文案继续说明所需操作。

## 验证

`packages/client/ui-conversation/tests/input-bar-styles.client.spec.ts` 以 CSS 文本读取样式表，断言提及该入口状态的规则只有 `.cardWorkspaceTrigger` 与 `.cardWorkspaceTrigger :disabled`，且模块中不再残留任何 SVG 虚线图案。整卡鼠标激活、键盘激活和选择器展开回显的组件覆盖保持不变，仍在该入口的其他 spec 中。`pnpm exec vitest run packages/client/ui-conversation` 通过 34 个文件、394 个测试。

## 考虑过的替代方案

**保留描边，仅在 hover 时显示。** 只对指针可见的入口对键盘和触屏读者不可见；而且评审要求的是去掉描边，而不是延后显示。

**保留描边，仅在键盘焦点时显示。** 对归档后进入该状态的读者而言，空编辑器上仍会画出虚线轮廓，而这正是描边失败的场景。

**改用填充表面或卡片内标签替代描边。** 卡片本就位于独立的 major-input 表面上，chip 与占位文案也已说明所需操作；再加一个信号会让一个读者只是路过的状态变重。

## 后果

未选择 Workspace 的卡片在视觉上与其他静止状态的编辑器完全一致，并且整卡可点击。该状态失去了"这是选择器而非文本框"的一眼可辨线索，因此可发现性依赖 Workspace chip 与占位文案；若要重新引入线索，应使用非虚线的方式，而不是恢复这圈虚线。
