# Agent Note: 会话搜索保持为选择启用

Status: implemented

[English](2026-10-01-session-query-stays-opt-in.md) | 中文

## Problem

[会话搜索默认提供](2026-10-01-session-query-by-default.zh.md)在四个已发布 preset 中都挂载了 `@aeven/tool-session-query`：五个工具（`session_search`、`session_event_search`、`session_trace`、`session_event_trace`、`session_event_read`）以及一段指导文本，相当于每一轮约 **426 tokens** 的模型可见文本。当时支持这一行的理由是：没有任何已发布组合提供从某个会话访问其同一工作区更早会话的途径；反对它的理由则在事后才被测量。

记忆基准的记忆组仅凭召回就答对了 21 个探针中的 20 个，且没有任何探针调用会话查询工具。这一观察**不是**关于这些工具的证据：基准挂载的是它自己的行（`@aeven/memory`、`@aeven/memory-memos`、`@aeven/memory-context`、`@aeven/tool-memory`），并不组装任何 preset 名单，因此探针从未拥有这五个工具。对 126 份已记录会话的扫描同样找不到任何一次调用，原因相同：这些行尚未提交，因此没有任何会话提供过它们。

剩下的是成本与未经测量的收益之比——在召回已经回答了被测问题的会话预算里——以及让召回变得可回答的那项修复（[显式搜索返回捕获到的原始消息](../bug-fix/2026-10-01-recall-returns-the-captured-message.zh.md)）已经覆盖了当初加入该行的场景：被提炼摘要丢弃的材料。

## Decision

四个已发布 preset 不再挂载 `@aeven/tool-session-query`。该包保留在代码树中，`apps/cli/package.json` 继续声明它，使挂载该行的 profile 仍能解析它，生成的工具目录也继续描述它：其中的条目本就写着该包为选择启用，如今这重新成为事实。

要重新主张这一行，需要一次将其与记忆提供方一起挂载的测量，并报告它回答了哪些召回未能回答的内容。

## Alternatives considered

- **保留该行，留待测量后再议。** 在测量存在之前，这一行会让每个会话、每一轮都付出代价，而测量需要的是一条基准条件而不是一个已提交的默认值；一旦该条件显示出收益，用一行即可恢复默认。
- **删除该包。** 它是唯一能读取会话自身更早转录的界面，包括任何提供方都未提炼的材料；调试或取证类组合仍需要它，删除它只会让一项选择启用的能力变得不可达，而不是不再计费。
- **只挂载两个搜索工具。** 把行减半，但保留同一个未经测量的赌注；而上一份笔记自身的论证——命中的下一步需要的是血缘和载荷——反对拆分。
- **改为提高记忆提供方的召回预算。** 召回与会话记录回答的是不同的问题：召回陈述被记住的内容，记录保存被说过的内容。

## Consequences

每个已发布会话从其请求中减少五段工具描述和一段指导文本，约每轮 426 tokens，模型在工具之间做选择时的范围也更小。需要原始记录的会话必须自行挂载该行。

随该行记录的锋利边缘对任何挂载它的人依然存在：在声明该包之前启动的 Host 无法通过 `$AVN_HOME/profiles/node_modules` 解析它，随后该 preset 会挂载失败。出于这一原因保留了 `apps/cli/package.json` 中的声明。

## Verification

`pnpm exec vitest run packages/preset/agent-presets` 通过 12 个文件共 186 个测试，其中包含 preset 名单与挂载规范。`grep -rn tool-session-query packages/preset/agent-presets/presets` 无输出，而 `apps/cli/package.json` 仍声明该依赖，快照用例 `snapshots/session/session-query-spill` 仍直接挂载该行。移除之后按原样重跑冻结的记忆基准；其记忆组即此后任何针对该行的主张都必须超越的基线。
