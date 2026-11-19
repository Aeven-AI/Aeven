# Agent Note：同步保管库在关闭期间读取已关闭的存储

Status: implemented

[English](2026-11-19-sync-vault-reads-closed-store-on-shutdown.md) | 中文

## 问题

2026-11-19 重启托管 Host 时，旧进程以退出码 1 结束。`AccountVault` 中的状态计时器在提供方关闭账户的 SQLite 存储之后触发并调用 `SyncStore.pending()`，从计时器回调中抛出 `The database connection is not open`，使进程在停止过程中崩溃。`dispose()` 会先清除待处理的计时器，但在等待应用、追赶、维护与发件箱流程期间，它自己的 `detach()` 改变了状态，`changed()` 又安排了新的计时器。中继套接字的关闭事件与迟到的帧走同一路径：提供方关闭存储后，`detach()` 与 `receiveFrame()` 仍读取 `store.enabled()`。

## 决策

`AccountVault.dispose()` 首先设置 `disposed` 标志。标志设置后，`changed()` 不再安排或发送状态报告，`detach()` 只丢弃中继与连接，`receiveFrame()` 不读取地丢弃该帧；该帧保留在中继上存储游标之后，下次连接时会再次到达。提供方保持原有顺序：关闭中继、关闭本地网络、释放保管库、关闭存储。

## 考虑过的替代方案

- **在 `dispose()` 末尾再次清除计时器。** 这能覆盖计时器，但覆盖不了套接字关闭事件或迟到的帧，它们在网络送达时随时到来。
- **在提供方中更晚关闭存储。** 保管库仍无法限定套接字关闭事件何时到达，因此任何顺序都会留下时间窗口。

## 后果

停止 Host 或退出桌面端时不再在 `sync-yjs` 中崩溃，systemd 记录为正常停止。释放开始后不再报告状态变化，这与账户正在关闭相符。`packages/sync/sync-yjs/tests/vault.spec.ts` 释放一个在线保管库、关闭其存储，然后投递一帧并关闭套接字，任何对已关闭存储的读取都会使测试失败。
