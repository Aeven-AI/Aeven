# Agent Note：`run_code` 失败信息携带恢复步骤

状态：已实现

[English](2026-10-26-run-code-failure-recovery.md) | 中文

## 问题

`run_code` 程序失败时，只告诉模型发生了什么，却把「接下来该做什么」留给模型自己猜。`code run failed (timeout): compute budget exhausted (60000ms busy)` 说明了原因，却没有下一步；`worker-exit`、`invalid-output`、`output-limit` 与 `abort` 同样如此。另外三类同级拒绝——`not dispatched`、`tool call abandoned`、`result discarded`——共享同一个前缀，却从未说明该调用没有产生任何效果，模型可能因此重试一次它以为已经落地的写入。

动手前也值得先量一下相反的假设：`run_code` 自己的 schema 约 930 个字符，只占 `ptc` 提示的 2.6%，而生成的 `tools:sdk` 声明占了 81%。压缩工具文案几乎不会带来任何收益；真正让模型浪费时间的是失败路径。

## 决定

### 每种失败类别一条恢复指引

`RECOVERY_BY_KIND` 把运行时的 `CodeRunFailure['kind']` 联合类型映射到那条能改变下一个程序的指令：修复后重跑，已完成的调用仍然生效；预算耗尽后减少单个程序的工作量；被取消或运行时进程消失后重跑；只返回可 JSON 序列化的值；少打印，或把大量数据写入文件。该表以运行时自己的联合类型定型，因此新增类别会在这里 `typecheck` 失败，而不是让模型收到一条没有任何建议的消息。

组合后的文本保持 `code run failed (<kind>): <message>`，随后是恢复指引，再是条件出现的 `Captured output:` 区块。运行时分类、会话日志与工具 schema 均未改动：这些字符串属于结果内容，已经是模型可见的，也已经作为 `tool/result` 记录。

### 所有「run 已结束」拒绝共用一条消息

`runOverMessage` 用同一个形状构造三类子调用拒绝：中止原因、工具名、该次调用发生了什么，以及后果——run 已经结束，这次调用没有改变任何东西，如果仍需要该结果就重新运行程序。

`invalid description` 同样说明了修复方式，于是模型在参数不合法时遇到的两条校验路径都会告知该发送什么。

## 验证

`packages/core/tools/tests/ptc.spec.ts` 固定了这两段组合文本——被放弃的子调用消息，以及带捕获输出的完整 `output-limit` 失败文本。工具描述与 schema 未变，因此 `docs/tool-catalog.md` 与已录制的 `tool-schemas` 快照保持有效；本改动没有引入新事件、配置字段或新的模型可见输入。
