# Agent Note: ACP 会话只通告客户端尚未持有的选项

Status: implemented

[English](2026-09-22-acp-announces-only-changed-options.md) | 中文

## Problem

九个黄金 fixture 在运行之间发生变化。同一场景单独运行连过五次（两次空闲、三次与单测套件同时跑），却在 `pnpm run check:all` 中失败，差异恒为少一行 `config_option_update`——两侧的 `session/new` 结果完全一致。

这条通告是 provider 注册顺序上的竞态。`packages/acp/acp/src/index.ts` 监听 `llm/adapters-updated`，并要求所有存活会话重新发布；而 `LlmRuntime.registerAdapter()` 会在每个 provider 行激活时发出该事件。于是 `session/new` 早于最后一个 provider 行注册的客户端会把模型目录收到两次，晚到的只收到一次。已提交的 fixture 固定了竞态的一侧，于是车道的判定由机器负载而非产品行为决定。本地 Aeven 网关已排除：把 `AEVEN_API_URL` 指向死端口行为不变。

## Decision

会话只通告客户端尚未持有的内容。`AcpSession` 记录上一次发出的选项——覆盖每条响应路径：`session/new` 与 `session/load` 的 `configOptions()`、`session/set_config_option` 的 `setConfig()`——`topologyChanged()` 在变更后的拓扑解析出同一列表时跳过通告。比较针对唯一生产者（`AcpModelControl.options()`）做结构化比较，键序固定，判定精确。

## Alternatives considered

在回应 `session/new` 之前等待 LLM 拓扑安定被否决，原因是"激活完成"并不等于"所有异步注册都已完成"：需要凭据或账户的路由本来就会稍后解析，因此"安定"只能退化为静默超时，而不是运行时真正拥有的信号。

让快照 harness 在写入输入前等待静默，可以在不动产品的情况下消除车道的抖动，但这是把竞态搬进测试：产品仍会通告客户端已经持有的快照，录制的转录依旧取决于客户端落在该等待的哪一侧。

在 fixture 中固定竞态的一侧正是这九个文件原先的做法，也正是它让车道的判定变成机器负载的函数——两侧同样正确，因此任何 fixture 内容都不可能"正确"。

## Consequences

- `config_option_update` 回到协议本意：告知客户端此前拿到的选项已不再是最新。它不再兼任"某个 provider 行激活完成"的信号，转录结果因此不再取决于激活顺序。
- 真实变更仍会通告：provider 消失、登录后出现的账户路由等都会解析出不同列表并发布——既有拓扑用例（含 "publishes recoverable options when the selected adapter disappears"）仍固定这一点。
- 九个 ACP fixture 已重录并去掉了冗余通告。`pnpm run test:snapshot` 为 114 通过、无失败（此前既有一个场景因漂移失败，这九个又会随负载翻转）；`pnpm run test:expected` 为 28/28。
- 新增用例 "stays silent when a topology change resolves to the options already published"：把跳过逻辑去掉后会因出现两条通告而失败，因此它观测的是回归本身而非时序。
