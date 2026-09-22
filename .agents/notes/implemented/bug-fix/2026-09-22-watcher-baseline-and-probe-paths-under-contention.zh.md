# Agent Note: 一个监视器基线与一个探针路径，都只在争用下现形

Status: implemented

[English](2026-09-22-watcher-baseline-and-probe-paths-under-contention.md) | 中文

## Problem

两个测试文件只在多个进程同时读写同一批文件时失败，且都被记录为饥饿。

在 PR #64 的计数修复之后，`packages/boot/app-boot/tests/hmr-config.spec.ts` 在十二路争用下 36 次运行中失败 3 次：两次是同组用例在 `120000 ms` 超时，一次是目标用例读到 `['one']` 而非 `['one', 'two']`。当时记录的假设是某个轮询器饥饿了整整 30 s 预算，并把 `/var/...` 与规范化的 `/private/var/...` 两个 StatWatcher 列为促成因素。

`scripts/locale-dictionary-parity.spec.ts` 则在一次完整 `check:all` 中因 `packages/fs/fs-observation-policy/src/oxlint-contract-<uuid>.ts` 报出 `ENOENT` 而失败，那是 `scripts/oxlint-contract.spec.ts` 创建后又删除的探针文件。

## Decision

两次失败都不是饥饿，且 HMR 的那个假设是错的。

Chokidar 在目录扫描完成时发出 `ready`，而这并不表示真正报告变更的按文件 `fs.watchFile` StatWatcher 已经取得基线。落在该窗口内的写入**根本不会产生任何一次 tick**。直接探测所vendor的 chokidar：十二路争用下 480 次投递丢失 5 次，空载 480 次一次不丢；每次丢失时编辑都确凿地在磁盘上（字节数 3 → 14，mtime 前进），而 StatWatcher 一次 tick 都没有触发。继续等待在 30 s 内无法找回其中任何一次，可见丢失是永久的，而非迟到。这正是 PR #64 从测试助手中移除的那个风险；它仍存活于注册自身的监视器中，而等待再久也无法修复它。

因此 `deliverChange` 改为读取注册已报告内容的读数，并反复触碰文件直至读数到达；若始终没有到达，则以磁盘上的字节数与修改时间失败。该用例通过一个 `fs.watchFile` 见证者提供这个读数，其周期与机制与注册相同，并在第一次刷新之前先证明其已就绪：HMR 串行化刷新回调，注册无法在第一次编辑内部报告第二次编辑，而见证者可以。重放只推进修改时间，因此该用例所断言的字节与编辑留下的完全一致。

同组用例改为像相邻用例一样以轮询启动，并反复施加刺激直到第一次广播证明监视器已就绪，且每次都把文件增大，使重放与"根本没有写入"可区分。它的文件在注册时并不存在，因此首个事件是 `add`，而这正是基线窗口最易命中之处。

对于 parity 用例，`withTransientProbeWindow` 只把探针写入方与编译器串行化，并不覆盖同一批目录树的读取方。与其为一个只需"不去读已消失文件"的读取方扩大该锁——那会让整个扫描排在每次探针与 `tsc` 运行之后——不如让 `walk` 跳过探针命名模式，使这类路径根本不会进入文件列表。真正缺失的字典仍然是错误：没有任何随产品发布的源文件命名为 `oxlint-contract-<uuid>.*` 或 `staged-lint-probe-<uuid>.*`。

## Alternatives considered

**放宽 HMR 的预算。** 丢失的投递是永久的，任何预算都够不到它。上述 30 s 测量即是直接证据。

**归咎于 `/var` 与 `/private/var` 两种拼写。** `findWatchRoot` 会规范化监视根，两种拼写指向同一个 inode。探测在不存在任何拼写分歧的情况下复现了丢失，因此这一项被排除，而不是继续挂起。

**把 parity 用例放进探针窗口。** 那会为一个只需排除单一文件名模式即可彻底消除的竞态，把一次只读扫描排在每次 Oxlint 探针与编译器运行之后。

**让 parity 读取方吞掉 `ENOENT`。** 该文件已在 `readEntries` 处重新抛出所有非 `ENOENT` 失败，以保证扫描永不静默收窄；在读取处吞掉同一个错误码，会让真正缺失的字典以"不存在"通过。

## Consequences

HMR 文件在两轮十二路扫描中 72 次运行全部通过，此前为 36 次中通过 33 次。同组用例的 120 s 挂起在此过程中先变成 32 s 的诚实错误，而这正是该 issue 所要求的失败形态：没有重试、没有睡眠、没有放宽预算、没有削弱断言，两个判据均未改动。

parity 用例在报告所涉目录树中持续搅动探针的情况下 25 次运行全部通过，而未修复的版本在同样条件下 25 次中失败 9 次，报出记录在案的 `ENOENT`。

chokidar 的底层行为未变，且仍适用于任何在监视器报告就绪后立即发出的首次写入。本仓库的答案依旧是 `eventuallyObserved`：反复施加刺激直到一次通知证明监视器已就绪，其后照常等待。
