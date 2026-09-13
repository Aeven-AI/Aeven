# Agent Note: 以单一实时阅读锚点承载历史分页

Status: implemented

[English](2026-09-13-live-reading-anchor-for-history-paging.md) | 中文

## 问题

在长 Session 中快速向上滚动时，历史被加载到错误的位置：每个到达的页面都会把读者从正在阅读的行甩开数千像素，并且每一页都在对话记录中表现为跳动。

在运行中的 Web 客户端上通过 CDP 以每帧 250 px 的速度向上快速滚动测得：一次页面到达使流高度从 10,402 px 增长到 66,213 px，而 `scrollTop` 只移动了 4,430 px，阅读线上的行落在距读者离开位置 381 px 到 919 px 之外。两个独立缺陷叠加导致此问题：

- `ChatView` 维护三个锚点。`anchorRef` 在页面请求开始时记录读者所在行及其视口偏移，`prependHoldRef` 将该记录固定到下一次滚动采样，`reflowAnchorRef` 只由 500 ms 的滚动采样刷新。请求进行期间仍在滚动的读者会被恢复到请求前的偏移；并且在滚动采样待处理时，提交时的补偿被直接跳过。
- 已落定的 Assistant 行在挂载后改变高度。引擎的 `Reasoning` 块将 `open` 初始化为 `true`，再在 effect 中自行收起；`MarkdownText` 在被动 effect 中把已落定文本写入引擎。每个已落定的推理轨迹都会以完全展开的状态布局一帧：一次 Session 切换测得 59,207 px 塌缩到 9,860 px，每个前插页面也是如此。

## 决定

`ChatView` 只保留一个 `ReadingAnchor`：滚动视口顶边处的行，以及该行在滚动内容坐标中的顶部（`flowTop(row) + scrollTop`）。滚动永远不会改变该值，只有该行上方的布局会改变它。`holdAnchorRef` 将 `scrollTop` 精确移动该行自上次记录以来的位移并重新记录；它在每次 ChatView 提交（位于采样待处理的提前返回之前）、每次观察到的高度变化以及每个滚动帧上运行。observed-top 账本只按实际施加的位移移动，因此两次采样之间的读者输入仍被识别为读者输入。程序化落点会重新记录锚点，而不是清除保持状态。`prependHoldRef`、`reflowAnchorRef` 和 `heldPagingAnchor` 已删除。

固定在底部的读者在保持逻辑中不读取布局：底部由跟随路径负责，因此流式提交没有开销。离开底部时，一帧通常只读取两次矩形；只有锚定行离开顶边后才执行命中测试。

已落定的行以最终高度挂载：

- `Reasoning` 在渲染期间推导 `open`：读者切换过时取读者的选择，否则取 `stream === true`；收起由保持挂载的轨迹上的 `.reasoning-wrapper.collapsed .reasoning-content { display: none }` 实现。
- `MarkdownText` 通过 `md` 把已落定文本交给 `HyperMarkdown`，引擎在构造函数中完成构建；之后的文本变化在 layout effect 中应用。

自动分页在距窗口头部四个滚动视口高度以内开始，下限为 1,500 px。分页加载指示器的槽位从 56 px 的 Session 标题栏下方开始，此前它被标题栏遮挡。

## 验证

重新构建受影响的 bundle 后，通过 CDP 在运行中的 Web 客户端上验证：

- Session 切换时对话记录以最终高度一次绘制（14,348 px、9,860 px、10,402 px），并停在距底部 0 px 到 1 px 处。
- 200 帧的快速滚动中，每页增加 7,832 px 到 10,479 px，没有塌缩尖峰；在阅读线所在行不变的落地帧上，该行移动 0 px。
- 通过未加载历史跳转到第 1 轮的导航轨跳转会落在该轮，1.5 s 后仍保持在那里。
- 页面加载期间，加载指示器是其中心点处最上层的元素，距滚动视口顶部 58 px。

`packages/client/ui-chat/tests/chat-view.client.spec.tsx` 在前插和回退用例中以内容坐标模拟行矩形，`packages/client/hypermarkdown/tests/correctness/reasoning.client.spec.ts` 固定已落定块以收起状态挂载。

## 考虑过的替代方案

**重新启用浏览器滚动锚定。** 它能原生保持读者所在行，但其调整以滚动事件的形式到达，跟随账本无法归因，这正是[退出锚定的记录](2026-09-12-transcript-scroll-anchoring-opt-out.zh.md)中的 Session 切换回归。

**在滚动视口上使用 `flex-direction: column-reverse`。** 前插不会移动阅读位置，但导航轨跳转、搜索落点、保存的位置和跟随账本都假定 `scrollTop` 以顶部为原点，因此该改动需要重写每个滚动使用方。

**在行上使用 `content-visibility: auto`。** 它能降低屏幕外的渲染开销，但固有尺寸估算会在行渲染时改变行高，这正是本次改动所消除的尺寸不稳定。

## 影响

[前插落定保持](2026-09-12-prepend-settle-hold.zh.md)已被取代：实时锚点在落定页面的每次提交中保持读者所在行，而不固定请求前的位置。

补偿仍以顶边处的行作为键，因此隐藏该行的布局变化（Turn 过程折叠）会重新选择锚点，而不在该帧进行补偿。
