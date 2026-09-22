# Agent Note: 用户 patch 层在 watch 报告就绪时完成一次对齐

Status: implemented

[English](2026-09-22-user-patch-layer-reconciles-at-readiness.md) | 中文

## Problem

`watchUserPatches()` 会 await `hmr.registerConfig(filename, refresh)` 并返回其 disposer，文档承诺"在确切路径 watcher 就绪之后"。而 `registerConfig` 只在 chokidar 的初始扫描结束时 resolve，那并不是它的通知流开始投递的时刻：落在两者之间的 `cordis.patch.yml` 写入不会有任何通知，refresh 回调一次都没有运行，应用启动时装载的那一层 patch 会在该进程余下的整个生命周期内保持陈旧，既没有错误、警告，也没有任何诊断。

在 12 核 macOS 主机上的实测：六路争用下 30 次运行中有 6 次丢失；两次完整 `pnpm run test` 中有 1 次丢失，那次 `packages/boot/app-boot/tests/user-patches.spec.ts` 的 "watches add, failure, recovery, and removal through transactional HMR" 用尽了它全部的 120 s 预算——这正是[由争用决定的 spec 等待 Agent Note](2026-09-22-contention-decided-spec-waits.zh.md) 已经为该用例调整到这个数值的预算，而这次丢失使它无论如何都无法恢复。`refreshes=0`，以及在 `watchUserPatches()` 之前就 arm 的独立 `node:fs` `watch()` 对那次丢失的写入报告 `fsEvents=0`，把丢失定位在通知通道上，而不是事件分类上：没有任何东西到达该进程。

## Decision

`packages/boot/app-boot/src/index.ts` 在注册 resolve 之后对齐一次。它执行与 watcher 处理已通知事件时相同的 refresh——重新读取 patch 文件、通过调用方的 `compose` 重新组合该层、事务性地重新应用到根 Include——因此就绪的含义与调用方一直以来的假设一致：交出 disposer 时磁盘上的文件就是已应用的层，此后每次写入都会被通知。Include 的 `Entry.update` 对与已装载配置深度相等的配置不做任何工作，所以文件没变时这一层对齐只付出那一次读取。

这次对齐属于 app-boot 的行为，而不是 watcher 的行为：

- app-boot 才是知道消费者装载了什么的一方。`hmr` 看到的是路径；已装载的那一层就是根 Include 自己的 config，正是有了它，"文件不同时才应用"才得以表达。
- 它让 `vendor/` 保持原样——那是固定的上游源码，带有同步流程和一份要求穷尽的本地修改日志。
- 它按[配置热重载韧性 Agent Note](2026-07-20-config-hot-reload-resilience.zh.md) 中 watcher 收容已通知 refresh 的方式收容失败：应用仍在运行，保留启动时装载的那一层，记录失败，并通过同一个 `hmr/config-update-failed(filename, Error)` 事件广播。这里只可能是启动读取之后才出现或变化的文件失败，因此注册 promise 会 resolve，而不会因为一次与启动竞争时序的写入而 reject。

## Alternatives considered

把 `ready` 当作充分条件、转而修改 chokidar 对 `add`/`change` 的分类，被否决：那次丢失的写入根本没有产生任何事件（`fsEvents=0`），分类不是缺陷所在。

轮询该文件、重试 refresh、或加长该用例的预算，被否决：该用例本就已经耗尽它自己的 120 s 预算，而同一个通知通常 10–22 ms 即到，因此任何等待都无法挽回通道从未投递的事件，轮询或重试只会让丢失更罕见，同时让陈旧的层继续存在。

在 `vendor/hmr` 中于 `ready` 之后对齐，被否决：hmr 无法判断消费者装载了什么，因此它只能在每次注册时都重跑该消费者的 refresh，即便那一层根本没有变化；这还会改变 `registerConfig` 对所有调用方的回调契约（"run serially on add, change, or unlink"），并成为一处需要修改日志与同步流程的 vendored 分歧。

沿用各 spec 现有的权宜做法（在 watcher 打开之前写入 patch 文件，让初始扫描将其报告为 `add`），被否决：它把丢失从测试里挪走，却把它留在应用中。

## Consequences

- 与 watcher 启动竞争时序的写入会被应用，而不是丢失；`watchUserPatches()` 的调用方现在可以依赖就绪时磁盘上的那一层。
- 每次注册多付出一次 patch 文件读取；那一层没有变化时，不产生任何 Include 工作，也不产生任何事件。
- 覆盖：`packages/boot/app-boot/tests/user-patches.spec.ts` 新增 "applies the write the watcher never announced by the time the exact watch is ready"——在本改动之前它会失败，文件里是 `live` 而该层仍是 `generated`——以及 "keeps the last applied layer and broadcasts when the missed write cannot be applied"；两者都通过打桩的 HMR 服务驱动"扫描到就绪"这段窗口，而不是靠争用循环。120 s 的 HMR 用例保持不变，且不再依赖初始扫描通知那次写入。
