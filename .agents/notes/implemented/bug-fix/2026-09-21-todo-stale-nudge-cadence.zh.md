# Agent Note：陈旧待办提醒的节奏与依据

Status: implemented

[English](2026-09-21-todo-stale-nudge-cadence.md) | 中文

## 问题

某个在线会话的待办停靠栏在该条目所描述的工作已经交付之后，仍然显示了七分钟的 `#17 in_progress`。从计划于 22:15:47 写入到 22:22:49 被替换之间，agent 完成了 issue #17（PR #22 已合并、issue 已关闭）与 issue #18（PR #23 已合并、issue 已关闭）——两者合计 29 次工具调用——而停靠栏仍显示 `#17 in_progress`、`#18 pending`、`#14 pending`。读者两次追问列表是否在保持同步。

停靠栏对它的输入是忠实的。它渲染 `todos` 投影，该折叠取用会话最近一次 `todo/write`，而日志中最近一次写入确实就是这样写的；只是这个计划已不再为真。为捕捉这种情况而存在的机制——陈旧提醒——在该时间窗内触发了三次，但只有第三次被采信。模型自己的推理记录下了原因。第一条提醒在模型刚写完计划的 11 秒后到达，它的开头是“The todos are synced — the nudge is automated; #17 IS in_progress which is accurate”。第二条在 15 次工具调用时得到“Todos are accurate (#17 in progress)”——而在那一刻它确实准确：完成 #17 的那个 PR 是在三次调用之后才出现的。第三条在 27 次工具调用时，是第一条真正成立的提醒，随即得到回应（“The todos are stale: #17 is done (PR #22 merged, issue CLOSED), and #18 is in progress …”），并在 46 秒后写出了修正后的计划。

该提醒的两个性质造成了前两次被驳回。它的节奏在每次写入时重置，且起始阈值为 3 次工具调用——按该会话每次步骤 1.35 次调用计算约为两个步骤——因此第一次挑战几乎总是落在一个模型刚刚写下的计划上：该会话 40 条提醒中的 21 条发生在其 26 次写入中某一次的 4 次工具调用以内，而且每次写入都会引来一条。而提醒文本不携带年龄信息：`Your todo list still shows 3 of its 9 tasks open.` 对一份三次调用前的计划和一份四十次调用前的计划描述完全相同，因此模型无法检验该前提——只能从转录中重新推导自己的历史，而它直到第三条提醒才这样做。引入该提醒的设计两个部分都具备：它在 8 个步骤后挑战、此后每 32 个步骤一次，并且其文本陈述了漂移（`Your todo list has not changed for <N> steps while …`）。后来一次大杂烩提交（`Land the in-flight workspace, layout and provider work`）把度量改为工具调用、阈值改为 3 与 12，并删除了年龄子句：第一次挑战大约收紧到原来的四倍，同时移除了读者分辨真实提醒与误报所需的依据。

## 决策

唯一个区间统辖该提醒：`STALE_WORK` = 自上次写入起除 `todo_write` 之外 12 次工具调用，既适用于第一条提醒，也适用于其后的每一次重复（在第一条之前 `remindedAt` 为 null，因此该区间从写入起算）。提醒会说明它被提出的原因——`Your todo list has not changed for 12 tool calls, while 3 of its 9 tasks are still open.`——而结算路径没有可引用的计数，因此改为陈述自己的原因：`Your todo list has not been updated since the background work you started settled, …`。

12 落在该会话自身的写入间隔之内。那里的相邻写入相隔 5 到 19 次工具调用（26 段间隔的中位数为 9），因此第一次挑战落在计划仍有可能是当前工作对象之时，而与所报告时间窗同样长的一段（29 次）会引来第二条。它还把同一会话的提醒量减半：模拟为 50 条，而实际记录了 40 条，且没有一条落在计划自身的写入之上。

原因子句是使提醒可被检验的部分，也正是本包在回读与提醒之间已经划出的“信息／显著性”分工。`has not changed for 24 tool calls` 是一条模型可以对照自己上次写入以来所做工作来权衡的断言；仅凭“仍有若干任务未完成”的句子，对新鲜计划与陈旧计划同样成立。

## 停靠栏渲染的内容

陈旧的横条来自一次陈旧的写入，而不是一次陈旧的渲染，重载与会话切换路径正是原因所在。浏览器在 `ProjectionValueStore`（`packages/api/session-controller/src/client/sessions/projection-store.ts`）中保存已完成的按 key 值：跟随打开时的基线按该基线的切点种入每一行，`{type: 'projection'}` 帧每次更新一行，序号更低或相等的帧则被丢弃。客户端既不折叠会话事件，也不持久化任何投影行，因此 `TodoDock` 的 `useProjection('todos')` 渲染的正是客户端所收到切点上的宿主值——重载或会话切换之后同样如此。

该基线是一个一致切点。`observeSession(…, { projectionMode: 'all' })`（`packages/session-query/session-query/src/observation.ts`）对已挂载的会话从注册表快照作答——`{ asOfSeq: cursorBefore(session.seq), values }`，每个值都折叠到同一日志位置——对冷会话则从以缓存为种、覆盖整份日志的水合作答，跟随路径会把它与打开快照一起发送（`packages/api/session-controller/src/history.ts`）。帧是仅变更式的：`drive()` 只在折叠状态与渲染视图同时变化时通知（`packages/session/session-projection/src/index.ts`），每次通知成为一帧（`packages/api/session-controller/src/control.ts`）。两个折叠都取用会话最近一次 `todo/write`，且都不在回合边界清空（[计划的生命周期](2026-09-16-todo-plan-survives-the-turn-boundary.zh.md)），因此停靠栏不可能比日志更旧——这正是为什么那七分钟的时间窗必须在写入处、在本包内修复，而不是在渲染路径上修复。

## 考虑过的替代方案

- **保留 3/12 的节奏，只加入原因子句。** 这是最省事的改动，而且确实让每条提醒可被检验。之所以否决，是因为它会继续在模型刚写下的计划上触发提醒，而这些提醒仍然是误报，一条如实说明自身年龄的误报仍然是对并未发生的工作的错误断言；“提醒是自动的”这一判断赖以形成的节奏依然存在。
- **原样恢复基于步骤的节奏（8 个步骤，此后每 32 个步骤）。** 忠于经评审的设计，但它以步骤为度量，而让计划过期的是工作量；而且其重复区间长到所报告的 29 次调用时间窗只会引来一条提醒。以工作为度量保留，阈值则依据实测间隔重新校准。
- **只要计划未完成，就在每个步骤上挑战。** 显著性最高、延迟最低。之所以否决：这会让提醒变成常量，而这正是教会模型忽视它的状态，并且每个步骤都会消耗计划的 token。
- **在提醒中附带自写入以来工具调用的摘要。** 模型在 27 次调用时自己推导出了漂移（“PR #22 merged, issue CLOSED”），因此点明这些工作可以缩短推断。这是推迟而非否决：把工具调用参数渲染为面向模型的叙述，需要本 harness 尚不具备的按工具规则，而计数加上计划已足以如实地陈述该断言。
- **强制和解而不是请求和解**——使用 `reject` 的 pre-step 决策，或在计划写入前扣住最终答复。循环没有提供这样的位置：`reject` 会让回合以受阻结束，为记账而丢掉工作；而最终答复之前也不存在任何可以以工具调用为条件的时点。不改动 agent-loop 就无法实现。
- **依据工具证据自动把条目标记为 `completed`**（一次合并、一个已关闭的 issue、一次通过的 gate）。之所以否决：从工具调用映射到计划条目的真值，恰恰是模型拥有而 harness 不具备的判断，而一次错误的自动完成比一次迟到的人工完成更糟。

## 后果

现在计划至少会经历 12 次工具调用而不被挑战，因此停止写入的模型会比以前更晚被提醒——这是本记录有意做出的取舍，因为更早的提醒并没有被读取。时间窗仍可能很长：在 27 次调用时模型采信了提醒，却把写入推迟到另一个 PR 之后（“Let me create the PR for #18, merge it, and update todos”），这是任何节奏都无法消除的残留行为，也正是提醒陈述自身年龄、而不只是陈述其紧迫性的原因。

提醒文本在两条路径上都多了一个子句，结算路径现在读到的是一句话，而以前与节奏提醒读到的字句完全相同。对长会话而言提醒量减半。折叠的形态未变（`workSinceWrite`、`remindedAt`、`stateVersion` 2），因此已持久化的 `todoStale` 行可跨此改动恢复；提醒区间没有留下任何需要迁移的状态。

## 待决事项

仍有两个载体可能让停靠栏持有的内容少于日志尾部；两者都是诊断本次事故时追踪到的，本记录不予修复，且都由既有测试固定。尚未挂载的会话，其打开基线在它的 agent preset 组合之前就已计算，因此宿主重启后，Web GUI 中打开的第一个会话会收到一个不含 `todos` 的块，`ProjectionValueStore.seed` 会为被省略的 key 清除该行，并且在下次 `todo/write` 之前没有任何东西重新发布该 key——此时横条是缺失而非陈旧（`packages/api/session-controller/src/history.ts`、`packages/api/session-controller/src/client/sessions/projection-store.ts`）。而宿主级控制流——投影*帧*的唯一载体——可能以终态方式静默失败：消费循环在 `console.error` 之后结束，而 `restart()` 没有任何生产调用方，这会让所有客户端投影冻结，直到页面重新加载（`packages/api/gateway/src/client/snapshot-stream.ts`、`packages/api/session-controller/src/client/index.ts`）。就本记录所测会话的证据而言，两者都不可达：该会话在整个时间窗内保持挂载，且其横条跟随了结束该时间窗的那次写入。

## 测试

`packages/todo/tool-todo/tests/stale-nudge.spec.ts` 驱动真实的 agent 循环并固定：11 次工具调用时静默，12 次时发出带有计数的提醒；计划已完成或从未写入时静默；24 次之前不重复，24 次时重复并携带新的年龄；结算路径的原因文本与摘要。折叠相关用例保留既有期望，它们不受节奏改动影响。上述会话证据来自一次读者报告的运行，并非固定夹具。
