# Agent Note：从代理列表停止

Status: implemented

[English](2026-11-07-subagent-catalog-stop.md) | 中文

## 问题

运行中的代理只能在它自己的编辑器里停止，这意味着要先打开它。一次性代理会选用只读编辑器，因此任何地方都没有 Stop：它唯一的取消渠道是委派工具调用的 signal，也就是 parent 的整个轮次。

## 决定

会话页头代理列表中每个运行中的行都带有一个 `ActivityRowButton` Stop（[`SubagentHeaderLineage.tsx`](../../../../packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx)）。它调用 `sessions.interruptSubagent(address)`，以该行自己的 mode 发送 `subagents/interruptByParent`，随后刷新该目录。在目录报告 child 空闲之前，该行显示“正在停止”，之后在列表保持挂载期间显示“已停止”；宿主拒绝时图标变红。

`interruptByParent` 接受 `mode: 'one-shot'`（[`packages/subagent/subagent/src/index.ts`](../../../../packages/subagent/subagent/src/index.ts)）。`SubagentRuntime.start()` 为每个在线一次性 run 记录其 parent 会话 id，并在 run 结算或被释放时将其移除。一次性停止会先核对 parent 地址，然后以 `{ kind: 'user' }` 取消本地 child 的轮次，或释放远程 run。随后进程内 driver 以 `aborted` 结算该 run，parent 的委派调用如同 parent signal 取消时一样返回。未知或已结算的一次性目标与可继续目标一样，是被接受的 no-op。

## 考虑过的替代方案

**释放所有一次性 run** 对本地 child 不可取。释放不仅停止轮次，还会释放 child handle；取消轮次则把清理留给已拥有它的 run 持有者。

**从一行停止整棵子树** 被推迟。权限模型只向下一层，子树停止需要宿主侧的树操作，而不是逐行调用。

## 影响

Stop 只结束当前轮次。可继续 child 保留其暂存的 inbox 与自身正在运行的 children，parent 自己的 Stop 仍不会停止可继续 child。一次性 child 的部分回答会以 `aborted` 结果到达 parent。
