# Agent Note：有界投影在会话回退时恢复其状态

Status: implemented

[English](2026-11-25-projection-rewind-transition.md) | 中文

## 问题

`contextBreakdown` 与 `contextPressure` 保留一个运行中的表面 token 总量与至多一个影价 claim，因此其持久化检查点保持 O(1)。对这个 fold 而言 `session/rewind` 不是表面事件，所以它保持总量不变。回退会把表面恢复到其目标之前的样子，包括后来被压缩遮蔽的区间，而总量却保留压缩之后的值。下一次压缩从这个过小的总量中减去被恢复区间的记录价格。在一个真实会话中，一次压缩把数字从 169,090 降到 42,544，回退到该压缩之前后数字仍停在那里，下一次压缩又以 53,158 为基数扣除 131,936 个 token，使 `messageTokens` 折叠为 −76,829。`contextBreakdown` 的视图 schema 拒绝负数，因此加载该会话历史时失败，报错 `failed to project session … messageTokens … Too small`。`contextPressure` 以同样方式漂移，其视图钳制掩盖了这个错误。

## 决策

`ProjectionDefinition` 新增可选的 `rewind(state, atTarget, event)` 转换。对声明了它的单元，`SessionProjectionRegistry` 把 `session/rewind` 交给 `rewind` 而不是 `apply`，同时传入该单元自身从 `init` 起、恰好折叠到回退目标之前全部事件所得的状态。完整折叠（`buildCell`，以及没有可用行的 `restore`）在每个被指向的 seq 处保留单元状态，从而一遍解析所有回退；状态不可变，因此保留的只是引用。实时回退（`drive`/`advanceCell`）只重放 Session 日志中目标之前的部分一次。若 `restore` 重放的尾部包含回退，该单元会从 seq 0 一遍重新折叠；所提供的日志起点更晚时则抛出错误，要求从 seq 0 重新读取。当前所有调用方都提供完整日志。

两个 token-meter 单元都声明了 `rewind`。`contextBreakdown` 从目标状态取 `messageTokens`，并保留最新的 envelope 数字，这与 `measure()` 一致——它在回退后仍沿用当前请求头。`contextPressure` 从目标状态取 `surfaceTokens`，并保留最新的用量样本，因此 `projectedTokens` 会按回退丢弃或恢复的表面移动。两者都丢弃任何已武装的 claim，并都提升 `stateVersion`，使 session-projection 缓存丢弃按旧语义折叠的检查点行。

共享的 `addSurfaceTokens` 以零为运行总量的下限。记录的影价来自写入它的构建所用的估算器，而追加按重放构建的估算器重新计价。因此跨估算器变更重放的总量可能低于后来的 claim，下限让这种漂移只是显示误差，而不会使会话投影失败。

## 考虑过的替代方案

**在单元状态中保留每个可能回退目标处的运行总量。** 无需访问日志即可精确，但持久化检查点每轮增加一项，破坏了影价协议所要维持的 O(1) 上界（[context-meter 说明](2026-08-05-context-meter-blind-to-compaction.zh.md)）。

**在每个 `session/rewind` 旁记录影价。** 这让 fold 无需访问日志，但会新增一种会话事件，每个回退生产者都必须经由 token meter 发出它；而且磁盘上已有的所有回退仍然没有价格，包括暴露这个缺陷的会话。

**只把总量钳制在零。** 这能让会话可加载，但在任何跨压缩的回退之后，`messageTokens` 在会话剩余时间里都是错的。

## 后果

每个感知回退的单元在每次回退时重放目标之前的日志一次，这与 `ctx.tokenMeter` 重建其定价表面所做的工作相同。冷折叠保持单遍，额外内存仅在折叠期间与回退数量成正比。在 `apply` 中自行折叠 `session/rewind` 的单元（turn-outline 单元）或必须忽略它的单元（`tokenUsage`，其计费总量从不回退）不受影响。估算器变更后的投影误差表现为以零为下限的偏低数字，而不是无法加载的会话。

## 测试

`packages/session/session-projection/tests/registry.spec.ts` 固定了实时驱动上的回退转换、嵌套回退在实时、惰性构建、冷折叠与检查点起步折叠中结果一致、尾部起点晚于目标时的重新读取错误，以及未声明该转换的单元仍由 `apply` 接收 `session/rewind`。`packages/llm/token-meter/tests/context-breakdown-projection.spec.ts` 复现压缩、跨压缩回退与第二次压缩，在每一步和冷 `restore` 中保持 `messageTokens` 等于 `measure().surfaceTokens`，并固定零下限；去掉 token-meter 的 `rewind` 转换时它会失败。把出错会话的存储日志重放进 `SessionProjectionRegistry`，三条路径都与对最终表面的完整规范重新计价（`foldSurface` + `estimateMessage`，58,798 个 token）一致：冷 `restore`、实时事件驱动（在回退处回到 169,090），以及从回退之前的检查点起步的 `restore`。在 64,081 个事件上，冷折叠约耗时 20 ms。起点晚于回退目标的尾部 `restore` 会抛出重新读取错误。
