# Agent Note: 由争用决定的 spec 等待

Status: implemented

[English](2026-09-22-contention-decided-spec-waits.md) | 中文

## Problem

`pnpm run check:all` 并发执行各道门禁，四个单独运行通过的 spec 在这种争用下失败。它们各有各的原因，且每个原因指向不同的失误，而不是"时间给少了"。

- `packages/experimental/inspector/tests/integration.host.spec.ts` 的 "cancels Client Runtime work when the Worker deadline expires" 配置了 `clientRuntimeTimeoutMs: 20`，而这是该 inspector 上所有 Client Runtime 命令共用的唯一预算。该用例的主题是从不 resolve 的 promise 触发超时，但用来证明运行时仍然可用的后续 evaluate 也得在这 20 ms 内完成，于是在负载高的机器上先超时了。
- 同一文件的 "keeps captured EventSource data readable when the caller aborts after response headers" 属于该文件里十二处裸写 `vi.waitFor(...)` 的等待之一，vitest 给它的默认上限是一秒。它们等待的都是经真实 Worker 往返的 CDP 事件，一秒是错误的预算：该用例在 abort 之后等待 `Network.loadingFinished` 时失败，随后的拆解又超出了钩子预算。
- `packages/storage/storage-json/tests/external-watch.spec.ts` 的 "reports a foreign write the sweep finds, and stays silent on a self-write the sweep sees" 分两次 await 完成"写入文档"与"标记为自己所写"，期间 30 ms 的 sweep 在跑。若有 sweep 落在两者之间，自写入就会被报出——而单元自身的注释明确允许这一点（"未打标记的自写入只会多报一次，由 domain 差分消除"）。该 spec 断言的性质比 watcher 的保证更强。
- `packages/boot/app-boot/tests/user-patches.spec.ts` 的 HMR 用例通过真实 chokidar 监视驱动四次文件系统通知，而等待每次通知的辅助函数把上限设为 30 s，用例自身预算却是 120 s。谁先到期由负载决定。
- `packages/experimental/code-runtime-python/tests/runtime-budgets.spec.ts` 的 "charges a forked descendant against the run CPU budget" 让每个子进程空转 1.2 s 的**墙钟**时间（`while time.time()-t<1.2: pass`），因此子进程退出时究竟烧掉了多少 CPU，取决于宿主如何调度它。

## Decision

每处修复都去掉负载所决定的那个输入，并点明所等待的状态：

- inspector 用例仍以超时为主题，但把预算设在一次带载往返之上（1 s，断言为 "timed out after 1000ms"）。唯一会超出它的仍是从不 resolve 的 promise。
- storage 用例改用该文件自身的确定性手法——`sweepOnly` 加手工驱动的 pass——让 pass 在打标记之后运行，而不是与之竞争。断言改为精确相等（`toEqual([{ table: 't', key: 'foreign' }])`），比原来的"永不包含 `mine`"更强；真实 sweep 触发器的覆盖由同一文件中的其它用例承担。
- HMR 用例的等待采用用例自身的 120 s 预算，因为所等待的工作是通知加上它触发的加载器重新激活，且要与三个同级 worker 争用并重复四次。
- Python 用例的子进程改为空转 CPU（`while True: pass`），由自身继承的软 `RLIMIT_CPU` 终止，因此无论调度如何都会贡献完整的一秒。
- inspector 文件里的十二处等待统一走一个具名辅助函数，给它们十五秒并写明所等待的对象——经真实 Worker 往返的 CDP 事件。

## Alternatives considered

统一调大超时被否决，因为它让所等待的状态无名可指；而且对 storage 用例而言再多时间也无济于事：断言本身强于 watcher 的契约，扫描窗口再长也只让多余的一次上报更罕见，绝不会不可能。

重试用例或让每个用例单独运行被否决，理由见[可靠性 skill](../../../../.agents/skills/avn-ci-test-reliability/SKILL.md)：重试掩盖了负载所决定的输入而不是去掉它，串行块也无法保护宿主资源免受其它文件或进程的影响——同一个 watcher、超时与计量器都与此文件之外的用例共享。

保留 inspector 的 20 ms 预算、只断言超时信息也被否决，因为那会丢掉真正重要的那一半：超时取消了请求却让运行时不可用，正是该用例存在的目的。

## Consequences

- 争用不再决定这些用例的结果；监视器、超时或计量器真正损坏时它们仍会失败，而且每处修复体现在断言上而非更长的 sleep 上。
- inspector 用例约需 1 s，external-watch 用例开销不变；HMR 用例只在本来会失败时才付出它的预算。
- Python 用例现在花的是子进程继承的预算而非宿主的墙钟，也顺带去掉了对 `time.time()` 在运行中跳变的依赖。
- 证据：相关文件均通过（external-watch 19 个用例、user-patches 17 个、inspector 文件 10 个用例、加了预算的 inspector 用例 1.4 s、Python 该用例连续三次通过），并以 `check:all`（55 项通过）作为验收运行。
