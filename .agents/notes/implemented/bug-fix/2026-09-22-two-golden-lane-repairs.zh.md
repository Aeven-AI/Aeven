# Agent Note: 两处黄金车道修复：没有脚本的场景，以及点开了起始会话的用例

Status: implemented

[English](2026-09-22-two-golden-lane-repairs.md) | 中文

## Problem

两个黄金车道用例在 `main` 上各自因自身原因变红。

`snapshots/session/subagent-tool-filter`（`recording: authored`）在比较任何内容之前就失败：`llm-replay: script exhausted — session requested model call #1 but its script has only 0`。`deriveReplayScript` 只从 `assistant/chunk` 事件组构建场景的模型脚本，而该场景的两个 fixture 从未包含过任何一组（`git log -S'assistant/chunk' -- snapshots/session/subagent-tool-filter/` 无输出）。仓库里也没有对应的侧车覆盖文件；而 `loadSessionScripts` 对**子会话**是从子 fixture 现场派生脚本、不读覆盖文件，因此只给主会话写侧车也补不上。

`apps/web/tests/minimal-preset.snapshot.ts` 的 "expands the completed persistent Bash call in the Web conversation" 按位置打开会话——`page.locator('[role="treeitem"]').nth(1)`——而应用启动时自带一个空的起始会话且排在前面。于是该用例打开的是那个起始会话，并在一个**正确地**为空的会话里等待录制内容。两个预算掩盖了这一点：用例把 `60_000` 压在车道 `testTimeout: 180_000` 之下，内部的定位等待又只有 10–15 s，于是失败以短暂定位超时呈现，看起来像渲染慢。

## Decision

场景 fixture 补上了其消息本身蕴含的 chunk 事件组（`snapshots/session/subagent-tool-filter/session.jsonl`、`session.1.jsonl`，内容直接从既有 `assistant/message` 推导），随后按 harness 流程重录，使 fixture 与 harvest 一致；重录还重新生成了子会话的 `tool-schemas.1.expected.json`，其中原先缺少 `str_replace_editor`。

web 用例改用 scaffold 明文约定的方式获取录制内容——按内容搜索，这也是首次搜索会打开懒加载索引 `session-query-sqlite`（`openAt: 'first-search'`）——而不再依赖行序号。其等待改为 `apps/web/tests/support.ts` 中具名的 `RENDER_WAIT_MS`，并且不再把用例预算压到比车道更窄。

## Alternatives considered

对场景而言，带密钥重录并不可用（它是 `authored` 而非 `live`，`AVN_SNAPSHOT=record` 只重跑 live 场景），而且那会用一次真实会话的内容替换手写内容。`replay.override.json` 侧车只能覆盖主会话，子会话那份空脚本仍会在它的第二次模型调用上耗尽。

对 web 用例而言，按标题匹配行被否决：起始会话的标题是录制会话标题的前缀，选择器会变成一次子串巧合。点击最后一行（邻近某个 spec 的写法）仍然编码了顺序假设，而不是身份。

## Consequences

- 两条车道由红转绿：`pnpm run test:snapshot` 报 114 通过、无失败；web 文件在 `AVN_SNAPSHOT=replay` 下连续两次 3/3 通过。
- 该场景现在证明的是它本来要证明的东西：子会话以被过滤的工具集运行，而不再在第一次模型调用之前就失败。
- web 用例现在会停在它所等待的状态上。此前的形态无法区分"慢"与"打开了错误的会话"，错误的会话正是靠着被压窄的预算存活下来的。
- 重录后的 web golden 记录了当前界面（`Open right sidebar`、`Back to bottom`）以及加载状态所处的位置；`captureStableAria` 会轮询到两次快照一致，因此那一帧是稳定的，而非加载中的瞬时状态。
