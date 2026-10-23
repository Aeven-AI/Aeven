# Agent Note: 日志内批量 payload 按场景固定伴随文件

Status: implemented

[English](2026-10-23-logged-bulk-payloads-pin-per-scenario-sidecars.md) | 中文

## 问题

已记录的会话 fixture 既是回放输入，又是预期输出，因此其中每个字节都是被审查的表面：维护者仅凭这些行判断 harness 是否行为正确。日志事件内的批量文本会淹没这一表面。请求的系统提示词与工具 schema 是成千上万个字符的静态组合，任何场景的行为都不依赖它们；而 `turn-review/request` 事件把审查提示词与整轮的 JSON 文本记录——该轮的用户消息、工具调用、截断后的工具结果与回复——放进同一个事件，重复了周边事件已经记录的对话文本。payload 内联时，提示词改动一个词就会重写每个记录审查的 fixture，把行为淹没在没人愿意读第二遍的文本里。

同一批事件还会在两个表面上生成。回放把规范化后的采集结果与已提交字节比较；刷新经由部分不同的流程，用一次新的运行写出已提交字节。两个路径相差一个字符时，刷新就会改写并未改变的 fixture，已提交形态不再是其自身规范化器的不动点，而维持无关值稳定的易变值保留机制也会对整个日志失效（[刷新易变值](../bug-fix/2026-07-27-stable-snapshot-refresh-volatiles.zh.md)）。

## 决策

已提交的会话 fixture 将小型结构性事件内联保留，把日志内的批量 payload 移到稳定 token 之后，并把可读副本放进场景自有的、位于该 fixture 旁的伴随文件。三个 payload 遵循这一规则：请求 header 的 `system` 变为 `{{system}}`，其提示词归于 `system-prompt.expected.md`；`tools` 变为 `{{tools}}`，对应 `tool-schemas.expected.json`；`turn-review/request` 的 `system` 与 `messages` 变为 `{{turnReviewSystem}}` 与 `{{turnReviewMessages}}`，对应 `turn-review.expected.json`。

### 审查请求保留结构，固定文本

`turn-review/request` 内联保留 `turn`、`round`、`route` 与 `maxTokens`。它们很小，并且是「哪条路由审查了哪一轮」这一断言本身。场景自有的 `turn-review.expected.json` 保存 `{prompt, requests: [{session, messages}]}`：提示词一份，随后是每个记录过请求的会话 fixture 的一条记录，其中 `session` 指名该 fixture 的索引，使子会话的请求归属于承载它的那份日志。同一场景中出现第二个提示词即令运行失败：语料库中所有请求都由同一个插件提示词产生，出现不同提示词意味着来源错误，而不是需要保存的变体。`turn-review/verdict` 保持内联，因为它很小，且正是 fixture 存在所固定的结果。

提取在 `redactSessionSnapshotIds` 之后进行，因此审查消息自身的 `id` 以稳定的 `{{message:N}}` token 进入伴随文件，而非新生成的 UUID。文本记录保留其来源事件携带的 token——工具结果中的 `{{cwd}}`、`{{spillLocator:…}}`——因此伴随文件呈现该轮的用户文本、调用与结果，而不含主机路径或会话身份。

### 规范化器导出该规则

`@aeven/session-snapshot` 导出 `normalizeSessionSnapshotsWithReview`，返回规范化后的 fixture 及其固定的审查证据；`normalizeSessionSnapshots` 委托给它并只返回 fixture，因此既有调用方保持原有契约。`turnReviewSnapshot(rawLogs)` 按 fixture 顺序（主会话在前）收集一个场景的请求。`scrubTurnReviewRequests` 把两个 payload 字段替换为 token，且是幂等的。`formatTurnReviewSnapshot` 与 `parseTurnReviewSnapshot` 拥有伴随文件的规范 JSON（两空格缩进、末尾一个换行）及其形态校验。`writeTurnReviewSnapshot` 与 `expectTurnReviewSnapshot` 是 headless、SDK 与 ACP 三个适配器共用的写入与比较两半：没有记录审查请求的场景不拥有伴随文件，因此写入端会删除残留文件，比较端会因多余文件而失败。

### cwd 规范化保留转义反斜杠

`scrubString` 的规范模式只在以 `{{cwd}}` 为根的路径内转换路径分隔符，从而保住正则、命令与模型撰写的文本。嵌套的 JSON 字符串值——审查文本记录就是其一——以 `\"` 结束带引号的路径，于是匹配越过了路径一个字符，重写把转义的反斜杠变成了分隔符：比较表面上 `cannot read "{{cwd}}/deleted.txt"` 变成 `cannot read "{{cwd}}/deleted.txt/"`，而 fixture 写入保持原形。规范化器因此保留转义嵌套 JSON payload 收尾引号的反斜杠，只转换路径内部的分隔符，使两个表面都对齐产品实际写下的字节。

### 语料库门禁维持该规则

`scripts/session-snapshot-corpus.corpus.ts` 对每个场景断言：每个 fixture 是 `scrubTurnReviewRequests` 的不动点；`turn-review.expected.json` 存在当且仅当该场景某个 fixture 记录了请求；伴随文件中的每个 `session` 索引都指名一个已提交 fixture。八个场景记录审查请求——`acp/fs-escalation-approved`、`sdk/persistent-tools`、`session/fs-delete-recreate`、`session/fs-edit`、`session/fs-write`、`session/fs-write-overwrite`、`session/fs-write-overwrite-bounded` 与 `session/session-sandbox-root`——随着改动文件的轮次在场景之间迁移，保持该集合正确的是门禁，而不是这句话。

## 考虑过的替代方案

**把 payload 保持内联。** 每个受审查的 fixture 便要在自身行内重复审查提示词与该轮的对话文本；提示词改动会重写数百行，审查表面也无法单独阅读。该 payload 是辅助证据——为辅助模型调用而引用的对话——而不是 fixture 所记录的对话。

**语料库级的单一审查伴随文件。** 全局单文件需要一个每个适配器都知晓的路径、该文件的所有者，以及两次写入结果不一致时的规则。它还会把所有场景耦合到所有提示词：提示词改动会让每个记录审查的场景失败，却没有任何东西说明这份伴随文件属于哪些 fixture。按场景归属无需 manifest 字段、跨 profile 来源间接指定与适配器符号链接——header pin 正因其伴随文件位于场景之外才需要这些。

**让提示词走 header pin 机制。** header pin 用于避免在各类 header 之间复制相同的提示词与 schema 文件。审查伴随文件无法使用该路径：其 `requests` 按设计逐场景不同，唯一共享的部分是一个 1352 字符的提示词，比任何系统提示词都小。复制它会在提示词变化时恰好让记录审查的场景失败，而这正是刷新必须重写的集合。

**在刷新写入路径中转换转义。** 在刷新写入处修补结尾分隔符，会让比较表面仍然在已记录文本里凭空造出字符，于是 fixture 会与一个误引产品自身日志的规范化器一致；此后任何嵌套 JSON payload 都会撞上同一个缺陷。

## 后果

- 受审查的场景提交三件产物：带 token 化事件的 fixture、可读的伴随文件，以及在 SDK 适配器下同样内联携带该事件的通知基准——后者是每个会话事件经身份与路径规范化后的线上传输记录，而非场景 fixture。
- 审查提示词在每个受审查场景的伴随文件中重复。这是静态文本重复唯一买到的收益：故障隔离。提示词改动只让记录审查的场景失败，不影响其他场景。
- 提示词改动会让回放在刷新重新生成提示词、请求与 fixture 之前失败；失败的比较会指名伴随文件，因此修复是对语料库跑一次刷新。
- 阅读伴随文件者通过 `{{message:N}}` token 把文本记录关联回 `session.jsonl`，而不是读取原始值——这是让伴随文件成为规范化不动点的代价。
- 规范化器因此带有一条关于嵌套 JSON 转义的规则，此后任何在 JSON 文本中嵌入 cwd 路径的 payload 都会继承它，而不必重新推导。

## 测试

`pnpm run test:snapshot` 无密钥地回放整个语料库，并在同一流程内运行语料库门禁；ACP、SDK 与 headless 适配器各自比较其场景的伴随文件，而新增或失去审查请求的场景会同时在伴随文件存在性与 fixture 上失败。`pnpm run test:snapshot:refresh` 从已提交的模型脚本重新生成伴随文件，因此 `@aeven/turn-review` 中的提示词改动会在刷新运行之前表现为受审查场景的伴随文件不匹配，刷新之后则表现为可审查的提示词差异。`pnpm run typecheck` 覆盖导出的表面。

## 相关资料

- [会话日志快照语料库](../testing/2026-08-24-session-log-snapshot-corpus.zh.md) 拥有语料库、其 manifest 类别，以及审查门禁所扩展的 fixture 保护。
- [ACP 快照测试](../testing/2026-06-19-acp-snapshot-tests.zh.md) 拥有会话日志回放、规范化，以及本规则与之平行的 header pin 伴随文件。
- [轮次复核与 bash 编辑守卫](2026-10-21-turn-review-and-bash-edit-guard.zh.md) 拥有复核调用、其提示词与它记录的两个事件。
- [快照刷新易变值的稳定](../bug-fix/2026-07-27-stable-snapshot-refresh-volatiles.zh.md) 拥有刷新写回，以及表面不一致为何导致 fixture 抖动。
