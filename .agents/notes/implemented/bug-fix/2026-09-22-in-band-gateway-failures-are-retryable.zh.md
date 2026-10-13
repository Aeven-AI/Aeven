# Agent Note: 带内网关失败在 Aeven 路由上可重试

Status: implemented

[English](2026-09-22-in-band-gateway-failures-are-retryable.md) | 中文

## 问题

`aeven-cloud` 路由（`@aeven/llm-aeven`）面向 Aeven 网关，而网关是模型提供方之前的第二道边界。网关一旦开始流式响应，其状态码就固定为 200，因此它再也无法以状态码上报的上游失败会以错误帧的形式出现在**流内**，携带网关自身的契约码（`provider_unavailable`、`provider_timeout` 等）以及上游的传输细节。

`DeepSeekAdapter` 的 `mapStreamError` 会把该词汇原样大写透出，而不是将其压平为 harness 的规范码——这是适配器已记录的决策：网关的码正是调用方据以路由的具体事实。但**可重试性**无人负责。共享的默认重试策略只认识规范码（`EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`），因此网关的码没有一个能命中，`@aeven/llm-retry` 于是交付下游而非重试：回合在第一次尝试就结束。

实际观测到的失败正是这一形态——`the provider failed after the response began: deepseek is unavailable: fetch failed: other side closed`——其中 `other side closed` 是网关的上游套接字在响应中途断开。同一个失败类若以状态码上报，会被归类为 503 → `SERVER` 并重试；以带内方式交付则不会，于是**交付路径**决定了用户的回合能否存活。网关在自己的契约中把 `provider_unavailable` 标为可重试，也就是说该路由与它所面向的边界判断相左。

## 决策

当组合未配置重试策略时，`aeven-cloud` 路由解析自己的策略：规范五码，加上网关契约认为值得重发的六个码——`PROVIDER_UNAVAILABLE`、`PROVIDER_TIMEOUT`、`PROVIDER_ERROR`、`RATE_LIMITED`、`CONCURRENCY_LIMITED`、`INTERNAL`。该取值刻意不写 `maxRetries` 与 `backoff`，让 `resolveRetryPolicy` 从共享预算中填充，共享预算因而仍是唯一为所有路由决定预算的地方。

该词汇属于路由上游的事实，而非传输层的事实，所以由路由拥有它：同一个 `DeepSeekAdapter` 也服务于 `deepseek-official`，而后者的失败从不携带 Aeven 的契约码。路由自有的策略仍然具有权威性——插件行或用户设置中的 `retryPolicy` 会整体替换该取值，且解析后的按路由策略依旧在注册时捕获，这符合[按提供方设定的请求重试策略](../feature/2026-07-24-provider-retry-policies.zh.md)的要求。

## 考虑过的替代方案

**在 `mapStreamError` 内把网关的码规范化。** 这会在失败已成为 harness 失败的地方补齐该文件自述的不变量，也能为未来任何位于网关之前的修复同一缺口。它落选是因为它推翻了已被测试固定的决策：适配器刻意保留网关的词汇（`PROVIDER_UNAVAILABLE`、`PROVIDER_ERROR`、`PROVIDER_TIMEOUT` 均被固定为透出），而把 `provider_unavailable` 压入 `SERVER`，等于为了修正一项任何路由都能直接声明的策略，抹掉调用方据以路由的具体事实。

**把这六个码加入共享默认集合。** 一次改动，所有组合生效。它落选是因为共享集合是提供方中立的：`deepseek-official` 以及未来每一条路由都会继承只属于该网关词汇的重试决定，而这些码也不再说明产生它们的上游。

**在该路由上解析 `mode: 'always'`。** 无界恢复不需要码表，也不会漏掉网关日后新增的码。它落选是因为它把请求与退避时间花在重发不可能成功的失败上——被拒绝的会话、耗尽的余额、超出的上下文——而网关自身的契约已把这些与本次采纳的瞬态失败区分开。

**把流中失败改为以状态码上报。** 对客户端而言最清晰，但不可能：上游死亡时响应头早已发出，这正是网关在关闭流时不给 `[DONE]` 的原因，好让客户端把它读作失败响应而不是一个短却有效的响应。网关的带内交付是正确的；需要分类所收到内容的是客户端一侧。

## 后果

- 该路由上的瞬态上游中断会消耗一次有界重试——按共享退避共五次尝试——而不是结束回合。被丢弃尝试的部分输出依旧不会进入下一次请求；该保证属于重试机制，本次未改动。
- 该路由的可重试性不再与共享默认完全一致，因此共用同一 DeepSeek 传输的两条路由在码集上出现差异。路由已说明原因：两者之中只有它在前面还有一道网关。
- 这六个码跟踪的是另一个仓库的契约。网关若重命名某个码，匹配会静默失效；网关若开始发送新的瞬态码，则需要在此处补上；该列表的事实来源是网关自身的 `RETRYABLE_CODES`，而非本文。
- `packages/llm/llm-aeven/tests/connection.spec.ts` 固定了省略时的解析结果：共享预算（`maxRetries: 5`、500 ms → 10 s、0.1 抖动）以及恰好十一个码的集合，因此被收窄或重排的列表会让测试失败，而不是让用户的回合失败。
