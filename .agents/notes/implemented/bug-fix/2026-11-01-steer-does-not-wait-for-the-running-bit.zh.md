# Agent Note: Steer 偏好不等待运行状态位

Status: implemented

[English](2026-11-01-steer-does-not-wait-for-the-running-bit.md) | 中文

## Problem

Composer 依据 `running` 决定 queue 还是 steer，而该状态位来自 Host 推送的列表项与快照。它在 turn 边界到达，可能落后一个 step：当 agent 恰好处于两个 step 之间时发出的消息，到达 `ComposerSubmissionPolicy.resolve()` 时 `running === false`，被接纳为 queue 项，需要第二次手势才变成 steer——会话日志正是这样一对：一次 `next-turn` 插入、它的取消，以及片刻后同一段文本进入 `next-step`。

这次降级没有保护任何东西。`Agent.steer()` 会插入 `next-step` 并唤醒 driver，因此它对空闲的 agent 同样有效；投递窗口属于 Host，而不属于一个可能落后一步的浏览器标志。

## Decision

只要 steering 可用，普通 Enter 就按 busy-Enter 偏好决定，无论 `running` 报告什么。加速和弦仍然反转该偏好，但只针对正在运行的 turn；空闲发送两种方式送达的内容相同，因此保持偏好。没有 steering 支持时——即面向 subagent——两种手势都保持 Queue。

prompt 路径改为按 agent 自身状态决定：`commands.ts` 仅在 agent 报告 running 时 steer，否则把同一条消息作为 followup 送达，开启下一个 turn。因此 turn 已结束后到达的 steer 会变成一个普通 turn，而不会在空闲循环上抵达 `agent.steer()`。

## Alternatives considered

**保留客户端检查并修正运行状态位** — 该状态位是 Host 状态在事件流上的中继，要让它精确，就得在每次发送前等待一次往返，而这正是乐观发送要避免的停顿。

**把每次提交都当作 steer 发送** — queue 与 steer 的区别正是读者所要的：排队消息不应打断正在运行的 turn，偏好是唯一表达该意图的信号。

**从 resolve 签名中移除 `running`** — 该值仍用于区分加速和弦的空闲发送，移除它要改动 slot 契约却换不来行为变化。

## Consequences

在 agent 工作时输入的消息，即使快照尚未跟上，也会作为 steer 到达正在运行的 turn；当 turn 确实已经结束，Host 会用同一条消息开始新的 turn，因此不会丢失内容，也不会被第二次手势挡在后面。

客户端不再报告它明知不可能的投递模式：它发出的模式是一个请求，由 agent 状态决定它是打断还是开启一个 turn。
