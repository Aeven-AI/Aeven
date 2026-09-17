# Agent Note：Chat 靠接近头部加载历史，而非按钮

Status: implemented

[English](2026-09-08-chat-automatic-history-paging.md) | 中文

## Problem

读取更早的 Chat 历史此前需要每页点击一次「加载更早」。每一页都要一次明确手势；该控件在 transcript 消息流内出现又消失，它的卸载会移动前插补偿正在保持的那些行——rail 跳转因此不得不专门把目标行钉住才能不被带偏。Turn rail 上存在同样的割裂：未加载标记宽 8px，而已加载标记宽 12px，整把梯子读起来像两套刻度而非一个会话。

## Decision

接近窗口头部本身就是请求。一个 latest-ref 判定函数由原始滚动处理器、分页结算、激活末尾校正和消息流 `ResizeObserver` 调用；当 `scrollTop` 距头部在 `max(clientHeight * 2, 600)` 以内时拉取下一页更早历史，并对内容根本不足以滚动的窗口进行填充，使较短的尾页也能让历史保持可达。跑道长度与视口相关，因为固定距离在更高的窗口里只占越来越小的比例，快速甩动就会在所需页面到达之前抵达头部。`scrollHeight` 只在低成本的 `scrollTop` 比较之后才读取，因为它会强制整个 transcript 布局。

`loadOlder` 只吞掉失败并让 `hasMore` 保持置位，因此「已结算但窗口头部未移动的拉取」是唯一可得的失败信号。据此停用自动分页，并把「加载更早」作为读者的重试入口放回，该点击会重新启用自动分页。只有 `loadingOlder` 由真变假的边沿才算结算：该 effect 在挂载时同样会运行，此时消费尚未返回的请求记录会做出错误判断。

头部边界改为零高度 sticky 覆盖层——即回到底部控件的模式——并承载 Trajectory 的历史加载转圈指示（`TrajectoryTable .historyLoadingSpinner`）。它完全不进入消息流，因此无论是出现、切换为重试控件，还是在历史耗尽时移除，都不会改变 transcript 的几何。未加载的 rail 标记保持与已加载标记相同的宽度，仅以变暗区分。

另外，任何需要保持不动的元素都不能待在滚动容器内部。弹性回弹会把滚动容器的内容整体移出任一端，而 `position: sticky` 并不能豁免——它随其所粘附的内容一起移动，这正是 composer seat、Turn rail、分页边界和回到底部都会跟着回弹、而 Session 头部从不跟随的原因。先尝试过用 `overscroll-behavior` 抑制回弹，已否决：那是为修一个定位缺陷而牺牲读者的滚动手感，且 `contain` 根本不消除本地回弹。

composer seat 移出滚动容器，成为其下方的 flex 兄弟节点，按顺序停靠。ConversationRoot 在其旁发布一个不滚动的覆盖层（`[data-conversation-chrome]`），该层带有 transcript 自身的两侧内缩以及滚动容器预留的滚动条宽度，Chat 通过 portal 把浮动控件放入其中。Turn rail 另外采用 `position: fixed`：滚动容器内的每一层祖先都会被回弹平移，因此只有视口是稳定参照——它让出详情栏宽度（由 AppFrame 发布的 `--avn-frame-details-width`）与滚动条宽度。回到底部的 composer 让位改为以覆盖层为作用域，而不再依赖它原先所在的滚动容器；其显隐也移到逐帧的活动轮次同步中——那里本就在做同一个触底比较，留在受节流的采样里会让控件延迟最多一个采样间隔才出现或消失。

ChatView 有两处读取随座位一起迁出：分页锚点不再扣除覆盖在滚动容器上的 composer（滚动容器的底边就是最后一行可见内容），消息流 observer 以兄弟节点方式查找该座位。它绝不能观察滚动容器本身——该回调会写入 `scrollTop`，在滚动容器自身尺寸变化时这样做会压平本次改动所要保留的回弹。

## Alternatives considered

**在头部放置哨兵元素并使用 `IntersectionObserver`。** 否决：持续相交的观察器不会再次通知，因此无论如何都需要由结算驱动的链式拉取；滚动几何在外层 `[data-conversation-scroll]` 宿主拥有滚动时同样有效，且可在 jsdom 下测试。

**限制连续自动拉取的次数。** 否决：`hasMore` 已经是数据自带的停止条件；设上限等于凭空发明一个限制，并把读者用滚动摆脱掉的控件再塞回去。通过 rail 跳到第 1 轮，本来就能把长会话整体加载出来。

**保留固定高度的流内边界行。** 否决：历史加载完毕、该行卸载时它仍会移动内容。覆盖层消除的是这一类问题，而不只是其中一个实例。

## Consequences

向前阅读变得连续，分页代价从每页一次手势降到零。长 transcript 的完整实体化现在可以靠按住滚动达成；渲染没有做窗口化，因此 `order` 每页都会取得新标识，`ChatNodeList` 会重建全部元素（被记忆化的 seat 会跳过各自子树）。若这成为瓶颈，杠杆是对渲染做窗口化，而不是继续加记忆化。`PAGE_MESSAGES` 仍为 50；调大它可以减少单位滚动内的前插补偿次数，是甩动流畅度仍不够时下一个可尝试的方向。

覆盖：ui-chat 中针对打开即填充、边距阈值、在途拉取的抑制、停用latch 及其手动重试、结算链式拉取、以及跳转对 pager 的占用的用例；ui-conversation 中一条 CSS 用例，把滚动容器的回弹抑制与它所保护的 sticky seat 钉在一起；chat-scroll e2e 改为通过抵达头部来驱动分页，并以 `[data-earlier-history]` 判定历史是否耗尽。
