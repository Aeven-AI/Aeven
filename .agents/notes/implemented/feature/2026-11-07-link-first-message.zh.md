# Agent Note: 链接带来的第一条消息

Status: implemented

[English](2026-11-07-link-first-message.md) | 中文

## 问题

aeven.io 落地页带有一个输入框。提交它会打开托管聊天，但输入框是空的，读者只得把同一条消息再输入一遍。未登录的读者要先经过登录界面，而 `redirect` 流程下的提供方登录会替换整个文档，因此消息必须在这两者之后仍然保留。

## 决定

落地页打开 `https://chat.aeven.io/#q=<消息>`。在认证关卡之前，`AppWebEntry.run()` 调用 `stashIncomingPrompt()`（[`packages/client/web/src/incoming-prompt.ts`](../../../../packages/client/web/src/incoming-prompt.ts)），把片段参数 `q` 移入该标签页 `sessionStorage` 的 `avn:incoming-prompt` 键，用 `history.replaceState` 从地址中移除它，并保留其他片段参数。空白消息会被丢弃。

`ConversationSession`（[`packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx`](../../../../packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx)）在会话列表报告所选 Session 为 blank 且尚未尝试发送时，用 `takeIncomingPrompt()` 取出存储的消息，设为草稿，并经由 `inputActions.submit()` 提交，与按 Enter 走同一路径。列表的 `blank` 标志就是 Hero 读取的那一个；仍在加载历史的 Session 快照同样报告 `blank`，只看快照会把消息发进已有的对话。所选 Session 已有历史时，消息仍保留在该标签页的存储中。

## 考虑过的替代方案

**查询参数（`?q=`）** 被否决：查询会到达服务器及其访问日志，而消息是读者自己的文字。片段从不离开浏览器。

**启动后再读取片段** 被否决：`requireSignIn` 会把地址改写为登录界面，`redirect` 提供方流程会在新文档中加载 `/oauth-result`，因此在任何插件运行之前片段就已消失。

**只填入草稿而不发送** 被否决：读者已经在落地页上按过发送。

## 影响

从链接到聊天的交接是两个互不依赖的包共享的一个键；两个文件互相指明对方。因所选 Session 已有历史而等待的消息，会在读者下次于同一标签页打开 blank Session 时发送。

## 验证

`packages/client/web/tests/incoming-prompt.client.spec.ts` 覆盖暂存、保留的片段参数与空白消息。`packages/client/ui-conversation/tests/skeleton.client.spec.tsx` 对列表为 blank 的 Session 经由输入外壳的默认 sink 把存储的消息发送一次，并对列表报告已有历史、而快照仍在加载的 Session 保留该消息。
