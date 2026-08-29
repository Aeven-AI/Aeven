# Agent Note：Client 保留 Console 事件并在 enable 时重放

Status: implemented

[English](2026-08-29-client-console-replay-on-enable.md) | 中文

## Problem

`ClientConsoleObserver` 在第一次 `enable(sessionId)` 时才安装 console hook，在此之前不捕获任何内容。启用并非本地动作：Worker 的 `ClientRuntimeRouter.subscribeConsole` 通过 ingest socket 发送 `client-console/enable`，Client 只有在该帧被派发时才安装 hook。没有任何东西确认这一帧，因此 `attachConsole` 一返回，Worker 就向 DevTools 公布 `Runtime.executionContextCreated`。

于是 DevTools 客户端得知 Client context 存在的时刻，严格早于 Client 开始观察它的时刻。Client 在该窗口内输出的任何日志都不是延迟送达，而是从未被捕获，之后也没有任何请求能够找回。

`packages/experimental/inspector/tests/integration.host.spec.ts > forwards Client Console objects through isolated realm sessions` 正落在这个窗口里：它在公布到达后立刻输出日志。该测试此前仅靠时序通过，当无关改动移动了这个窗口后便每次运行都失败；而向 Worker 添加任何日志都会让它重新通过 —— 正是这一点指认出竞态，而非订阅丢失。

## Decision

**Client 在整个 transport generation 的生命周期内观察自身 console，而不是在一个 Console session 的生命周期内。** `reset()` —— 已经在每次 `connect()` 开始时以及 socket 关闭时被调用 —— 负责安装 hook 并清除上一个 generation 保留的内容。`disable()` 不再卸载 hook，因此一个 session 离开到下一个 session 到来之间的窗口仍在观察之中。

**捕获的事件会被保留，并在每个 session 启用时重放给它。** `enable(sessionId)` 在实时投递开始前先把保留的事件投递给该 session，并忽略重复的 id，使重复 enable 不会重放两次。重放针对启用方 session 自己的 object table 物化每个事件，因此 Runtime domain 保证的按连接对象隔离保持不变。

**保留上限是固定常量，而非配置。** `MAX_BUFFERED_CONSOLE_EVENTS` 限制一个 generation 的 pre-enable 窗口所能容纳的量。它约束 Client 为一个可能永不接入的调试器所保留的内存；这不是随部署而变的选择，也没有消费者要求调整它。

这正是 Chrome 自身 Runtime domain 的做法 —— `Runtime.enable` 重放 console 历史，而不是从调用那一刻开始 —— 因此消除竞态所采用的行为，恰是 DevTools 用户本就预期的行为。

## Testing

inspector 套件 20 个文件 137 个测试全绿。该具体 spec 在改动前 6 次运行失败 6 次，改动后 4 次运行全部通过。没有测试断言旧的丢弃行为，因为旧行为是竞态而非既定 contract。

## Alternatives considered

**在公布 context 之前确认 `client-console/enable`。** 否决：以此代价换来的是错误的保证 —— 它要新增一个消息类型、其 codec 以及两侧 face 的 dispatcher 分支，并让 `Runtime.enable` 的响应卡在通往每个 Client 的 socket 往返之后。它能把公布顺序摆正，却依然会丢失 Worker 决定订阅之前输出的内容，而重放覆盖了这一点，确认则没有。

**改测试而非改产品。** 否决：这种丢弃是静默且永久的，而 Client 在启动期间输出日志是常态而非测试造物。把竞态固化为既定行为，等于把缺陷留给第一个真正去找那条 Client 确实发出过的日志的用户。

## Consequences

Client 的 `console` 方法在整个 transport generation 生命周期内保持被包装，而不再只在 DevTools session 接入期间。该包装本就先调用原始方法并吞掉自身的失败，因此可观察的 console 行为不变；代价是每次调用一层间接，以及被保留的事件，两者均有界。

被保留的事件在 generation 重置前持有对所记录值的强引用，因此输出大对象的 Client 会将它们保持可达，直至保留上限。这与浏览器为 console 历史所做的取舍相同。
