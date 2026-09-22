# Agent Note: 陈旧提示有了录制固定点

Status: implemented

[English](2026-09-22-the-stale-nudge-has-a-recorded-pin.md) | 中文

## Problem

`packages/todo/tool-todo` 的陈旧提示是模型可见输出，却没有任何 keyless 的会话录制覆盖：无论 #41 之前的文案还是之后的文案，都不出现在任何 fixture 中，只有 `tests/stale-nudge.spec.ts` 覆盖其行为。因此 `STALE_WORK` 与两句提示都可以随意变化而两条黄金车道全绿——#41 把阈值从 `3`/`12` 合成 `12` 并改写句子时正是如此。

现有的 `snapshots/session/todo-write`（`recording: live`）只写一次计划，绝不触发提示，因为触发它需要在写入之后有十二次非 `todo_write` 的工具调用。

## Decision

`snapshots/session/todo-stale-reminder/` 在同一个会话里录下了提示的两条分支：用 `todo_write` 写入三项计划、十二个彼此不同的 shell 步骤（即节奏所计的工作量）、第一条提示、一次对账，随后一个后台 `bash` 任务——它的结算本身就是新闻，产生结算分支的句子——以及最后一次对账。fixture 旁边的 `/` 组合叠加层挂载了真实的任务提供者（`@aeven/jobs-local`），否则结算分支根本不会出现；重放侧的兄弟文件（`cordis.snapshot.yml`）用 `llm-replay` 替换 DeepSeek 适配器，其余各行相同。

命令故意各不相同：十二次完全相同的调用还会触发 `repeat-tool-reminder`，那条通知就会挤进同一份录制。

## Alternatives considered

扩展 `snapshots/session/todo-write` 被否决：该场景是 `recording: live`，而提示需要十二个刻意的步骤出现在转录里，重录必须是带密钥的实时重录，而那个 fixture 的主题是写入而不是提示。只固定节奏分支也被否决，因为结算句子是另一条决策路径（`label !== undefined` 会跳过节奏判断）产生的不同文案，只固定一句会让另一句无人看守。

## Consequences

- 两句文案都进入了车道：`has not changed for 12 tool calls` 与 `has not been updated since the background work you started settled`，连同 `tool-todo` 通知的转录摘要以及它前后的 `tool-jobs` 结算通知。
- `pnpm run test:snapshot` 为 115 通过、无失败，且该场景在重放与 refresh 两种模式下都通过；它是手写场景，不需要 API key。
- 该场景自带组合，因此提示触发条件的变化会以这份 fixture 的 diff 呈现，而不再无声通过。
