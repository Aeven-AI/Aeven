# Agent Note: 轮次失败的对话框与重试

Status: implemented

[English](2026-10-23-turn-failure-dialog-and-retry.md) | 中文

## 问题

以终态失败结束的轮次会在 transcript（文本记录）中打印一行内联提示：一个笼统的标题、提供方给出的消息，以及放在 `<code>` 元素里的失败错误码——`AUTH`、`RATE_LIMITED`、`PROVIDER_UNAVAILABLE`。错误码是网关的词汇，不是用户能据以行动的东西，而该行也没有提供任何继续该轮次的方式。失败的轮次还会留在 transcript 中，因此用户下一次尝试会显示在一次失败记录之下。

## 决策

`packages/client/ui-chat/src/client/chat/MessageItem.tsx` 中的 `TurnErrorNodeView` 针对最新轮次的终态失败打开 `TurnErrorDialog`，而不是渲染一行提示。`turnFailureKind` 把 `turn/end` 上记录的错误码归入六个文案分组之一——额度（`QUOTA`）、上下文过长（`CONTEXT_WINDOW_EXCEEDED`、`MESSAGE_COUNT_EXCEEDED`）、已退出登录（`AUTH`、`MISSING_CREDENTIAL`、`INVALID_CREDENTIAL`）、繁忙（`RATE_LIMIT`、`RATE_LIMITED`、`CONCURRENCY_LIMITED`）、连接（`TRANSPORT`、`TIMEOUT`、`SERVER`、`INTERNAL`、`PROVIDER_ERROR`、`PROVIDER_TIMEOUT`、`PROVIDER_UNAVAILABLE`），其余或缺失的错误码归入「其他」——`TURN_FAILURE_COPY` 指定该分组在语言词典中的标题键与正文键。

对话框提供三个操作。「稍后再说」关闭对话框，并把失败键（节点键、序列号与时间）记入模块级集合，挂载时查询该集合，因此被忽略的失败在本页面生命周期内保持隐藏，刷新后再次出现。「重试」通过 `editMessage` 重跑该轮次自身的提示词，该路径会先回退失败的轮次再发送；只有所有者提供了 `editMessage`、该轮次的提示词已载入且文本非空时才提供。Host 拒绝重试时对话框保持打开以便再试一次。额度类失败额外提供一个按钮：关闭对话框并调用 `openPlans`，`apply.ts` 把它接到 `settings/open` 的 `account` 段，随后重试的请求使用在那里选中的方案。

只有最新轮次的失败会显示：当节点的轮次不是时间线中的最后一个时，`TurnErrorNodeView` 不渲染任何内容，因为后续轮次已经回应了它。失败错误码仍记录在 `turn/end` 事件上；对话框不显示它。

## 考虑过的替代方案

**保留带失败错误码的内联行。**错误码命名的是传输层的分类，而不是读者所处的处境，而且该行不提供重试，用户只能凭记忆重新输入请求，同时失败的轮次仍然可见。

**把同一提示词作为新消息再次发送来重试。**transcript 会因此持有两份请求，以及那个带有错误的失败轮次；让「重试」经由 `editMessage` 会先回退失败的轮次，于是重试的轮次替换了它。

**在每个失败分组上都提供方案选择入口。**连接失败或已退出登录的会话通过重试或重新登录解决，更换方案对两者都没有影响；该按钮与额度文案一起出现，而后者正点名了补救方式。

## 后果

- transcript 不再打印失败错误码；结构化错误码仍留在持久的 `turn/end` 事件上，供日志和后续读取方使用。
- 用户忽略过的失败在页面刷新之前一直隐藏；会话已经越过的轮次的失败从不打开。
- 重试需要在已载入的快照中找到该轮次的用户提示词：从历史中途打开的 transcript，或省略了 `editMessage` 的 transcript，只提供「稍后再说」；没有 `openPlans` 的宿主同样只提供这一项，而不提供方案按钮。
- 对话框是模态的，因此在用户忽略它、重试或打开方案之前，其后的输入区不可用。
- 文案由语言词典拥有：英文、中文与西班牙语词典中各有六个标题/正文对，以及 `turnError.plans`、`turnError.retry`、`turnError.dismiss` 与 `turnError.close` 标签。
- `packages/client/ui-chat/tests/chat-view.client.spec.tsx` 固定了每个错误码的文案分组、对话框的标题与正文、额度之外没有方案按钮、以该轮次的序列号与文本调用重试、对话框关闭后调用方案选择入口、忽略操作，以及已越过的轮次不显示失败。
