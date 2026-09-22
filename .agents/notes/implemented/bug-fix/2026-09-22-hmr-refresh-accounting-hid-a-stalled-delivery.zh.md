# Agent Note: HMR refresh accounting hid a stalled delivery

Status: implemented

[English](2026-09-22-hmr-refresh-accounting-hid-a-stalled-delivery.md) | 中文

## Problem

`packages/boot/app-boot/tests/hmr-config.spec.ts` 的 `serializes refreshes and waits for them during disposal` 在提交 27066260e0 的一次完整 `pnpm run check:all` 中令 `test` 门失败，报出 `expect(maxActive).toBe(1)` 的 `expected 2 to be 1`，而该断言的含义是两个刷新回调同时运行。

这个重叠既无法被该用例观察到，也不是产品行为。回调的 `active += 1` / `active -= 1` 没有 `try`/`finally`，而它的第一次调用会在正在运行的刷新内部通过 `deliverChange` 投递第二次编辑。投递被拒后异常越过 `active -= 1`，把 `active` 留在 1。HMR 在刷新被拒后仍保留注册（`vendor/hmr/src/index.ts` 的 `refreshConfig` 捕获拒绝、广播 `hmr/config-update-failed`，并在 `state.dirty` 仍持有已排队编辑时再次运行回调），于是那次排队运行把陈旧的 1 加了成 2，报出 `maxActive = 2`。失败运行中该用例耗时 30020 ms，正是该助手自身的 30 s 投递期限，可见整个事件就是这次拒绝。

该助手还用了一个无法证明此事的工具来证明此事。它自行注册 `fs.watchFile` 并等待该监视器报告编辑，但 `fs.watchFile` 是相对它取得的第一个 stat 比较，而那个 stat 是异步的：同一进程在注册后立即发出的写入可能落在它之前，成为基线，此后永不报告。本机探测中，立即写入有 100 次中的 10 次因此丢失；延迟 20 ms 的写入 100 次全部报告；时间戳粒度未造成任何丢失（50 次同一毫秒内的重写全部报告）。所以风险来自基线，而非时钟、间隔或磁盘。它的失败文本声称这次编辑“根本没有到达磁盘”，而 `maxActive` 所计的那次刷新恰恰是注册的监视器排队的——该监视器只报告发生变化的路径。

## Decision

判据保持不变：`expect(maxActive).toBe(1)` 与 `expect(observed).toEqual(['one', 'two'])` 原样保留。

`active += 1` / `active -= 1` 被放进 `try`/`finally`，刷新被拒不再可能把计数器留在高位；该用例记录这次拒绝，并在 `await disposal` 之后重新抛出。因此投递失败或刷新被拒都会以那个错误令本用例失败，并指明文件与其等待的数值，`maxActive === 1` 只用于报告真实的重叠。

`deliverChange` 改为在编辑前后立即读取该文件自身的字节数与修改时间，不使用计时器，也不使用第二个监视器；当两者都未变化时抛出错误并指明这两个值。其后仍保留一个轮询周期，供注册自身的 `usePolling` 监视器把磁盘上的编辑转成排队刷新。

## Alternatives considered

**在 `vendor/hmr/src/index.ts` 修复串行化。** 并不存在需要修复的并发刷新。`refreshConfig` 为每个注册保留一个状态对象和一个任务，在 `state.running` 已置位时直接返回，并以 `do { state.dirty = false; await refresh() } while (state.dirty)` 排空已排队的编辑；注册的 disposer 等待同一个任务。要出现重叠回调就需要第二个任务，而这要求 `refreshConfig` 在第一个任务体的同步前缀中运行——即 `state.running = task` 之前——进而要求刷新内部出现同步的监视器回调。Chokidar 的回调由事件循环投递。对失败形态的插桩运行显示，在计数器读数为 2 时，正文内部最多只有一个回调（`maxBodies = 1`）。

**放宽助手的 30 s 期限。** 该停顿是轮询器的基线问题，而非延迟问题；更大的预算只是把等待挪走，仍会报告从未发生的重叠。

**反复重放编辑直到监视器报告。** 第二次写入相对新的基线是可见的，但那会用另一次编辑替换本用例投递的编辑，助手也就报告了一次它并未验证过的投递。`eventuallyObserved` 为尚未开始监听的监视器重放刺激，那是另一种状态。

**去掉投递证明，只保留一个周期等待。** 该用例会与注册的轮询器竞争，并以 `observed` 为 `['one']` 失败——这是诚实但更晚、更难读的信号，且对编辑在磁盘上留下的状态没有任何说明。

## Consequences

停顿的投递现在以自身错误令本用例失败，而不再呈现为幻影重叠：修复前复现 `maxActive = 2` 的故障注入，修复后在 357 ms 内以投递错误失败；真实重叠仍是 `maxActive === 1` 唯一可能的失败方式。

那次运行中该助手的 `fs.watchFile` 与注册的轮询器为何整整 30 s 的预算内都没有对上，目前仍无解释。探测显示该基线窗口真实存在且对负载敏感，而 `tmpdir()` 的 `/var/...` 拼写与注册所监视的规范根 `/private/var/...` 是两个彼此独立的 `StatWatcher`——同时注册两者会把进程的活跃 `StatWatcher` 计数从 1 提到 2——所以二者可以不一致；究竟是哪一个被饿死，尚未复现。同一竞争条件下，通过原生监视器等待首次广播的兄弟用例 `normalizes refresh failures and broadcasts them without escaping the watcher` 曾一次在 120000 ms 超时，此处不作改动。
