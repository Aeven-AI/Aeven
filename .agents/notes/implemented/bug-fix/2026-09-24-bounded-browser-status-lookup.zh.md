# Agent Note：有界的浏览器状态查询

Status: implemented

[English](2026-09-24-bounded-browser-status-lookup.md) | 中文

## 问题

`@aeven/tool-browser` 在每轮的第一步，于循环追加 `step/start` 之前，通过 `browser/automation` waterfall 读取当前打开的页面。在 Web 组合中，该 waterfall 由 `@aeven/api-remotes` 转发给 Typert 网关，网关把它投递给每个已连接的 Client，并且只有在每个投递都得到应答后才结算。按设计，挂起的转发 waterfall 没有截止时间：审批或用户提问必须等待 Client 连接。

该查询只带着本轮的 signal 等待这个 waterfall。当没有 Client 能够应答时，每个会话中的每个新轮次都停在 `turn/start` 与 `step/start` 之间，而已经越过第 1 步的轮次继续运行。2026-09-24，四个轮次（其中两个是子代理轮次）停滞了最长 16 分钟，并在一个新浏览器标签页连接并应答挂起查询的那一刻同时恢复。`preview_*` 工具也存在同样的无界等待，并且没有声明工具超时。

## 决定

对该 waterfall 的每次等待都由一个经过校验的 `Config` 字段限定：

- 第一步查询在 `statusTimeoutMs`（默认 2000 ms）的 `deadline` 下运行，并与本轮 signal 合并。有界 signal 随请求传递，因此它触发时网关会取消挂起的事件；插件还让 waterfall 与该 signal 竞速，因为监听器没有义务遵守 signal。未获应答的查询以 debug 级别记录，本步不带浏览器上下文继续；监听器失败以 warning 记录。
- 每个 `preview_*` 工具把 `actionTimeoutMs`（默认 60000 ms）声明为其 `timeoutMs`，因此 `@aeven/tool-call-timeout-policy` 会中止调用，模型收到 `TOOL_TIMEOUT`，而不是一个永不返回的调用。

## 考虑过的替代方案

**没有 Client 连接时以 `next` 结算转发的 waterfall。** 这能一次性修复所有可选的转发查询。它被否决，因为网关的挂起生命周期正是让审批或用户提问送达稍后连接的 Client 的机制；尽力而为的读取方不得为必须等待的调用方改变这一点。

**移除第一步查询。** 这会失去模型用来判断请求是否涉及当前页面的环境上下文。

## 后果

- 在没有 Client 连接的 Web 部署中，每个新轮次在第一步之前最多花费 `statusTimeoutMs`，而不是无限期停滞。
- 在截止时间之后才应答的 Client 不再为该轮提供页面。
- `packages/web/tool-browser/tests/tool-browser.spec.ts` 固定了有界等待、请求 signal 的取消、等待期间的轮次取消、声明的工具超时以及配置校验。
