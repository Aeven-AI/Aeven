# Agent Note: 会话内容加载 overlay

Status: implemented

[English](2026-09-08-conversation-content-loader.md) | 中文

## 问题

在 Session 的第一页历史打开期间，ChatView 会在 transcript 栏渲染本地化的「载入历史…」一行。因此切换 Session 时会闪出空白或过期内容以及文本占位，而不是在新历史到达前盖住会话栏。已经打开的 Session 仍会重新挂载 ChatView，因此在两个内存中的 Session 之间切换会在那次提交上卡住，且没有遮罩。列 overlay 也会在 `#avn-preloader` 的 400ms 淡出期间画在它下面，于是会同时看到两个转轮。

## 决策

`ConversationRoot` 在所选非 hero Session 尚未绘制完成时显示 Aeven 内容加载转轮。ConversationRoot 拥有 `<header>` 元素，因此该外壳在切换时保持挂载；session header slot 填入 title row。overlay 是仅由 CSS 实现的 fixed layer，从 `top: 0` 延伸到 `bottom: 0`。其 `100cqi` 宽度会在侧边栏滑动时跟随 AppFrame 的 center column，而继承的 details-column 宽度会锚定其右边缘。因此它会从浏览器 viewport 的第一个垂直像素起横跨完整会话栏，但不会覆盖侧边栏或 details column；按[层叠决定](2026-09-09-content-cover-behind-composer.zh.md)，它从 composer 座位背后穿过而不是盖在其上。绘制完成的定义是：`conversation.session` 已挂载且 `openState` 为 `open` 或 `error` 之后再经过两帧 animation frame。显示是同步的，因此切换 Session 会在同一帧盖住 transcript。ConversationRoot、session header 与 composer 保持挂载：`session-maybe` 在 Session 切换时保持该 incarnation，header 标题来自 Session 列表。只有 `conversation.session`（ChatView）在 overlay 那一帧卸掉，并在转轮呈现后再过两帧 animation frame 重新挂载。该 slot 卸掉期间，空的 `.transcriptHold` 以与 active `.viewArea` 相同的 `flex: 1 0 auto` 作为 scroll-body 兄弟，sticky composer 因此仍停靠在底部；没有它时 seat 是唯一的 flex 子项，会坐到栏顶。回到先前已绘制过的 Session 时，重新挂载仍会覆盖。隐藏会把 opacity 淡出 400ms，然后卸载。

当 `#avn-preloader` 仍在文档中且尚未 `.screen-hidden` 时（包括页面预加载页的 400ms 淡出），该 overlay 保持不活动。一旦该元素变为 `.screen-hidden` 或不存在，若该栏仍未绘制完成，overlay 就会出现。session body 在页面预加载页下继续挂载，以便历史可以在其下绘制。

overlay 使用 `--dsw-alias-bg-base` 与 `--dsw-alias-label-primary`。其无障碍名称是 `content.loading`。ChatView 不渲染载入历史那一行。

## 验证

ConversationRoot 测试覆盖正在加载的 Session、仍为 cold 的所选 Session、摘要已证明空白的 hero 豁免、绘制后再 400ms 淡出、已经打开的 Session 切换在 overlay 呈现前卸掉 body 然后再挂载、卸掉期间 transcript hold 作为 composer 的前一个兄弟、overlay 在文档结构中不进入 header 与 composer、正在淡出的 `#avn-preloader` 抑制 overlay，以及该元素变为 `.screen-hidden` 后 overlay 出现。ContentLoader 测试覆盖立即显示、淡出，以及在另一个 Session 开始加载时取消淡出。content-cover 测试覆盖绘制等待、hero 豁免、推迟的切换重新挂载、预加载页淡出与 screen-hidden 交接、回到先前已绘制的 Session，以及缺少 `requestAnimationFrame`。ChatView 的打开失败用例仍断言错误行，并断言旧的载入历史文案不存在。Chrome 在 Design system 切换到 WebOS 期间的验证确认：侧边栏打开时 fixed loader 位于 `(280, 0)`，尺寸为 `1448 × 941`；侧边栏关闭时位于 `(0, 0)`，尺寸为 `1728 × 941`；两种状态都与 center column 完全一致。

## 考虑过的替代方案

**保留流内文本占位。** 它盖不住该栏，因此切换 Session 仍会闪出空 chrome。

**复用静态页面预加载页。** 该视觉是 document 范围的，并且在第一份外壳载荷后已经关闭；每次切换 Session 再打开会盖住侧边栏。

**只把 overlay 放在 ChatView。** Trajectory 与其他 session view 不会被盖住，并且 overlay 会随 ChatView 重新挂载，而不是在切换帧盖住常驻栏。

**只覆盖 `cold` 与 `loading`。** 已经打开的 Session 仍会重新挂载 ChatView；那次提交就是两个内存中 Session 之间切换时看到的卡住。

**在 overlay 出现后再过两帧仍继续调用 `conversation.session`。** 该 slot 读取当前 Session，因此这次调用会在 overlay 的第一次提交里重挂 ChatView。

**把 `conversation.session` 包进常驻 flex hold。** Overlay CSS 要求 `[data-slot='conversation.session']` 是 `.scrollBody` 的直接子项；空 hold 再设 `display: contents` 又会没有可伸长的 flex 项。

**每次切换 Session 都重挂 ConversationRoot。** 标题已在 Session 列表里，composer 是常驻的；拆掉外壳会跟 transcript 一样等待 Session face。

**用 Session/Conversation 快照决定 Hero 还是停靠。** 它们在列表之后才绑定；Conversation 快照缺失时 `shellPhase` 为 blank，已打开的 Session 会被当成空 hero，于是输入会离开停靠位置一帧。

**在页面预加载页淡出期间显示列 overlay。** 页面预加载页已经盖住文档；当它的 opacity 下降时，第二个转轮会透出来。

## 后果

切换 Session 会立即盖住会话栏的完整高度，包括已经打开的历史和 composer 区域，同时侧边栏与 details column 保持在 loader 外。session header 与 composer 保持挂载，并从 Session 列表就地更新；ChatView 重新挂载期间输入仍停靠在底部，因为 transcript hold 占据了 `.viewArea` 的 flex 项。Hero 与停靠 composer 由该列表的 `blank` 决定，不由 Session 或 Conversation 快照决定，因此这些快照绑定时输入不会离开停靠位置。已证明空白的新 Session 仍会进入 hero，不出现转轮。减少动效时 overlay 会直接卸载，不做 400ms 淡出。在 `#avn-preloader` 下的首次加载不会显示第二个转轮；若该元素变为 `.screen-hidden` 时 ChatView 仍未绘制完成，center-column overlay 就会出现。
