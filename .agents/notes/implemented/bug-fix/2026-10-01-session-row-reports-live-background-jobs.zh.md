# Agent Note: 会话行如实报告运行中的后台任务

Status: implemented

[English](2026-10-01-session-row-reports-live-background-jobs.md) | 中文

## 问题

工作区浏览器的会话行（[`@aeven/client-ui-workspace`](../../../../packages/client/ui-workspace/README.zh.md)）只用两个事实描述一个会话的活动：`SessionSummary.running`（Host 侧按 `ctx.agents.get(session.id)?.status === 'running'` 计算，见 [`session-controller/list.ts`](../../../../packages/api/session-controller/src/list.ts)），以及沿 subagent 来源血缘统计的运行中子代数量。两者都看不到后台任务。

任务会比启动它的那个轮次活得更久。`run_in_background` 的 bash 与 pwsh 运行、后台 pty 发送、后台 subagent，都会在属主 Agent 于 `turn/end` 转为空闲后继续注册在册。因此轮次之间，行显示中性圆点，或显示该轮次结束时点亮的绿色已完成提醒，而任务仍在工作。在报告问题的那个会话里，头部任务操作显示 `1 job active` 并带加载标记，而会话自身的行显示 `Idle`、没有任何标记：同一份工作，两个答案，而行是错的那个。

这个故障只出现在轮次结束到其任务结算之间的窗口里，而这恰好是读者使用列表的那个窗口——判断某个会话是否还需要自己。

## 决定

会话行自带运行中任务计数。`SessionNode.runningJobCount` 与 `SearchResultNode.runningJobCount` 在 [`tree.ts`](../../../../packages/client/ui-workspace/src/client/tree.ts) 中由 `SessionListState.jobsBySession` 派生，而后者是客户端列表状态已经从 Session Controller 控制流镜像而来的按会话任务行；[`Rows.tsx`](../../../../packages/client/ui-workspace/src/client/rows/Rows.tsx) 中的 `sessionStatuses` 把每个非零计数作为 `ongoing` 状态报告在主要状态之旁。

派生只发生在客户端。Session Controller 的控制 baseline 与 `jobs` 帧已经把每个会话可见的任务送到每一个已连接的浏览器，因此在本次改动之前这个事实就已经在协议线上；忽略它的只有行派生这一处。`runningJobCount` 统计 `running` 与 `stopping` 记录，与头部列表用于自身行的判定相同，因此正在被停止的任务会一直保留标记，直到结算。

行的状态现在按此顺序解析：等待交互仍是主要状态，运行中的 Agent 仍是主要状态，运行中的任务的优先级高于已完成提醒、但低于前两者。一个 Agent 在运行、同时任务也在运行的会话，报告 `Running` 并在旁边附带任务计数，与运行中子代已有的报告方式一致。文案沿用头部列表自己的措辞——[`ui-jobs`](../../../../packages/client/ui-jobs/src/client/locales.ts) 里的 `{n} job active`——于是一个事实在两个界面里读起来相同。

`SessionSummary.running` 保持其仅指 Agent 的含义。它是输入框的停止控件、排队或 steer 的提交策略以及 `conversationPhase` 所读的事实，而运行中的任务并不是一个正在运行的轮次：没有任何人在等待该用户的下一条消息，也不存在可停止或可 steer 的轮次。把任务并入其中，会把下一条消息排进一个并没有任何东西在运行的会话。

## 考虑过的替代方案

**扩展 Host 的 `running` 位以包含任务。** 这样行上就不需要新字段。否决：在所有其他消费者那里，`running` 的含义都是「Agent 正在执行一个轮次」（[`submission-policy.ts`](../../../../packages/client/ui-conversation/src/client/input/submission-policy.ts) 在它置位时把提交排队或 steer，[`InputBar.tsx`](../../../../packages/client/ui-conversation/src/client/input/InputBar.tsx) 在它置位时提供停止按钮），因此后台任务会悄悄把读者的下一条消息吞进一个永远不会启动的轮次的队列里。

**为侧栏列出的每个会话各开一条任务名单流。** `ctx.jobs.watchRows(sessionId)` 已经在服务选中会话的头部列表。否决：侧栏列出读者拥有的每一个会话，而为每行开一条 Gateway 流，换来的是那条始终打开的控制流已经送达的事实。

**读取客户端任务模型保存的名单。** `ClientJobsModel` 持有同样的行，但只针对其头部列表正在观察的会话。否决：那些名单只在其自身列表挂载期间存在，于是侧栏给出的答案会取决于读者当时打开了哪个会话。

**只报告 `Running` 文案，而不报告任务计数。** 否决：它陈述了一个关于 Agent 的不成立的事实，而计数才是告诉读者一个看起来空闲的会话为何仍被标记为在运行的原因。视觉隐藏的状态文本是该行唯一的状态报告，因此它必须点名正在做的工作。

## 后果

一个处于轮次之间、且有运行中任务的会话，会在列表里保留加载标记，直到它最后一个任务结算，然后回落到 Agent 空闲边沿所点亮的提醒，因此标记占据该位置并不会丢失任何信息。也就是说，在会话未被选中时结算的任务，最终仍然以绿色提醒收尾；提醒本身未变。

每行每次派生只多一次 map 查找，遍历的是客户端已经持有的行。没有任务的会话报告 `0`，渲染与之前完全一致。

按[注册表的 `list` 语义](../../../../packages/jobs/jobs/README.zh.md)，控制流给出的按会话行在每个会话中都包含无属主任务，因此一个无属主任务会标记每一行。这与每个会话的头部列表已经展示的集合相同，而无属主任务只出现在于 Agent 之外启动工作的生产者那里；已发布的生产者中没有这样的例子。

## 测试

[`packages/client/ui-workspace/tests/tree.client.spec.ts`](../../../../packages/client/ui-workspace/tests/tree.client.spec.ts) 钉住派生：一个会话持有运行中与被停止中的任务时报告 `2`，而只持有已完成与已停止任务的会话报告 `0`，在平铺列表与搜索结果两条路径上都如此。[`packages/client/ui-workspace/tests/rows.client.spec.tsx`](../../../../packages/client/ui-workspace/tests/rows.client.spec.tsx) 钉住呈现：只有任务的会话报告任务状态、不被描述为运行中，也不报告已完成提醒；而运行中的会话同时报告其运行状态与任务计数。

报告的场景已在运行中的应用上复现，修复也在其上验证：一个 Agent 在任务运行途中转为空闲的会话，改动前读到 `Idle` 且没有标记，改动后在同一个运行中的任务上读到 `1 job active` 并带标记。
