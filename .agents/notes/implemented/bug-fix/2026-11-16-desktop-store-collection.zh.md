# Agent Note: 桌面端 pnpm 存储只保留已安装 profile 引用的内容

Status: implemented

[English](2026-11-16-desktop-store-collection.md) | 中文

## Problem

每个桌面版本都会把其种子的 pnpm 存储合并进位于 `$AVN_HOME/desktop/pnpm/store` 的持久存储，而从来没有任何步骤从中删除包。2026-11-16，所有者的 Mac 上该存储占 11 GB：11,217 行索引，其中 10,285 行是过去版本的第一方 `file:desktop-packages/…` 压缩包，而活跃与 rollback profile 只引用 1,269 行、0.67 GB。每次更新，每台安装都会大约多出一个版本的包集合。

## Decision

`applyRelease` 激活一个 profile 后，在仍持有包事务锁时，`collectDesktopStore`（`apps/desktop/src/store-collect.ts`）删除活跃、rollback 或 prepared profile 的任何 `pnpm-lock.yaml` 都未列出其 integrity 的每个存储包。它先在一个 SQLite 事务中删除这些索引行，再删除剩余行的包文件与构建副作用都不再引用的内容对象，最后对索引执行 VACUUM。先删行、后删对象，因此中断只会留下供下次收集的未引用对象，而绝不会留下文件已不存在的索引行。若某个已存在的 profile 没有 lockfile，收集不做任何改动；不符合 `<integrity>\t<id>` 形式的索引键会被保留；存储中出现 pnpm 布局之外的条目时，在任何改动之前中止；失败只记录日志，不会让激活失败。pnpm 索引读取器从 `apps/desktop/scripts/` 移到 `apps/desktop/src/pnpm-store-index.ts`，由种子构建与收集共用。

在所有者存储的一个 APFS 克隆上运行时，收集删除了 9,948 行和 18,112 个对象，共 10.0 GiB，用时 1.7 秒，剩余 750 MB；随后用收集后的存储对活跃 profile 执行 `pnpm install --offline --frozen-lockfile`，复用 921 个包、无需下载即完成。

## Alternatives considered

**`pnpm store prune`**：pnpm 11.7 会删除每个只有一个硬链接的内容对象。在 APFS 上 pnpm 以克隆方式安装 profile，因此抽样的 4,000 个对象都只有一个链接：prune 会清空存储，包括下一个版本用 `pnpm add --offline` 加入其 profile 的插件包。

**以硬链接安装 profile，使 `store prune` 可用**：会改变每个 profile 的落地方式：构建脚本修改自身文件的包会修改共享的存储对象，而 APFS 克隆避免了这一风险。

**启动后在单独的加锁任务中收集**：让收集不在激活路径上，但包锁不会等待：收集期间的插件安装或后台版本准备会以 “another package transaction is active” 失败。在锁外删除对象也不安全，因为并发安装可能在索引提交与对象删除之间复用该对象。

## Consequences

收集只在激活某个版本的启动中运行，并在那里增加约两秒；各台安装在下次更新时变小。只被某个已不再安装的旧 profile 使用过的包，若插件以后需要，必须重新获取；收集之后回滚依然可用，因为 rollback profile 的 lockfile 属于保留集合，而它的文件早已落地。本地压缩包 integrity 目录（`file+desktop-packages+…`，所有者的 Mac 上为 37 MB）不在收集范围内。
