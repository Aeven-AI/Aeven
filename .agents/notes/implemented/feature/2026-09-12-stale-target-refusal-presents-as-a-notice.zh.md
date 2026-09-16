# Agent Note: A Stale-Target Refusal Presents as a Notice, Not an Alarm

Status: implemented

[English](2026-09-12-stale-target-refusal-presents-as-a-notice.md) | 中文

## Problem

带防护的变更在其目标于本会话读取与写入之间发生变化时以 `FS_STALE_VERSION` 失败，`@aeven/tool-fs` 将其渲染为 `cannot write "<path>": file changed since it was read — re-read the file, then retry`。[拒绝性编辑笔记](2026-09-11-refused-edit-presents-as-a-notice.zh.md)为这类拒绝引入了弱化提示呈现，并有意把这个错误码排除在外，理由是文件在读取者眼皮底下发生变化是「需要权衡的事实，而不是会话自行采取的步骤」。但在旁观者眼里，该行并不是这样读的。陈旧读取是另一个进程、格式化工具、第二个会话或读取者自己的编辑器改动过文件后的寻常结果，也是会话消除得最机械的失败：重新读取、重试、结束。它却穿着完整的错误处理——错误配色的状态圆点、错误配色的失败行，以及工具注册表加在行首的 `Error: ` 前缀——于是被读成 harness 的缺陷，而不是版本守卫在履行职责，而这正是弱化提示呈现本要回应的抱怨。

## Decision

`NOTICE_ERROR_CODES` 包含 `FS_NOT_OBSERVED` 与 `FS_STALE_VERSION`。两者都是带防护变更的拒绝，其面向模型的消息都写明了消除它所需的读取：`remediateFsError` 为带防护变更抛出的每一个 `FS_STALE_VERSION` 追加 `— re-read the file, then retry`，版本守卫的目标已不存在情形（`file no longer exists`）也包括在内。判定始终依据结构化错误码，绝不依据消息文本，因此提供方一侧的拒绝与策略一侧的拒绝落入同一类，而工具规范化后的某个句子也不会认领本清单从未核对的失败。

该行保留使其成为失败的一切：状态仍为 `error`，消息仍是折叠摘要，展开后的输出仍保留错误配色，辅助技术的状态仍为「失败」。软化的仍是与另一个错误码相同的两处——前导指示器改为 `StateDot` 的 `warning` 状态，折叠行改为 `.noticeSummary` 而非 `.errorSummary`；`data-notice` 为该行标记，供 CSS 与测试使用。接线未变：`FileMutationRow` 掌管 `edit` 与 `write`，也就是仅有的两个会上报该错误码的工具，它本来就在转发该标志。

## Alternatives considered

**从弱化提示行中去掉工具注册表的 `Error: ` 前缀。** 该前缀是该行中最响亮的词，也是读者在读到补救办法之前先起反应的东西。否决：折叠行就是已定结果自身的第一行，一个弱化了外观却改写其所引用文本的行，会与一次点击之外的展开输出、以及转录所代表的会话日志相矛盾。该前缀还承载着配色并不承载的事实——这次调用是失败而非带着奇怪摘要的成功——而警报本由状态圆点构成，而非这个词。

**让该错误码继续作为警报，只弱化其文案。** 否决：该呈现维度已经存在，把它花在一种带防护变更的拒绝上，而另一种写着完全相同的下一步，会让读者不得不自己去学 harness 期望他们对哪些拒绝处之泰然。

**改为匹配消息文本中写明的补救办法，而不是列出错误码。** 否决，理由见[拒绝性编辑笔记](2026-09-11-refused-edit-presents-as-a-notice.zh.md)：文本匹配同样会认领本分类从未核对的失败，而结构化错误码已在源头区分了写明补救办法与未写明的情形。

**自动重新读取目标并重试该变更。** 否决：版本守卫的存在正是为了拒绝基于会话从未见过的版本的写入。代模型重试会把它撰写的内容覆盖到另一个写入者产出的内容之上，把模型本可推理的拒绝变成静默覆盖。

## Consequences

两类带防护变更的拒绝现在都读作信息：可见、可展开、仍被宣告为失败，且不再与真正的失败争夺注意力。代价是警报覆盖率收窄——陈旧目标可能是某个竞争写入者的症状，而读者会希望注意到它，该行如今比过去安静。细节在软化后仍然存在：消息及其补救办法就在行上，展开后的输出仍保留错误配色。分类清单仍是维护要点，因为每增加一个错误码，都会让转录的每一位读者的某个警报变得更安静。

## Verification

`packages/client/ui-tool/tests/tool-row.client.spec.tsx` 锁定分类：`FS_NOT_OBSERVED` 结果与 `FS_STALE_VERSION` 结果是弱化提示，任何其他错误码的失败都不是，运行中或成功的调用也永远不是。`packages/client/ui-tool/tests/diff-card.client.spec.tsx` 锁定渲染出的 `write` 行：`data-state="error"` 且带 `data-notice` 与 `.noticeSummary`、不带 `.errorSummary`，并且消息及其补救办法在折叠状态下即可读。
