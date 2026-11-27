# Agent Note：启动器管道错误导致 Host 退出

Status: implemented

[English](2026-11-27-launcher-pipe-errors-end-the-host.md) | 中文

## 问题

2026-11-25 17:24 UTC，托管 Host 因一个未处理的 `Socket` `write EPIPE` `error` 事件以状态 1 退出；该错误由 `spawnSubprocess` 调用的 [`@aeven/subprocess-executor`](../../../../packages/subprocess/subprocess-executor/README.zh.md) 中 `spawnProcess` 的 `Socket.end` 抛出。`spawnProcess` 用 `control.end(script)` 把命令脚本写入就绪启动器的控制管道；该启动器在池中等待时已经结束，因此写入失败。所有启动器管道上都没有监听器，Node 便把该错误作为未捕获异常抛出，所有托管账户都失去了正在运行的轮次。

## 决定

`Executor` 在辅助进程交来的每条管道（stdin、stdout、stderr 和 control）到达时，为其挂上一个 `error` 监听器 `ignoreLauncherPipeError`。命令的结果另有来源：辅助进程会为 Host 已取走的启动器发送 `exit`，在启动器先于 `taken` 通知结束时发送带退出状态的 `gone`，并且辅助进程本身结束时 `Executor` 会结束每条正在运行的命令。在命令 stdio 上监听的调用方仍会收到同一个错误。

## 考虑过的替代方案

**只捕获 `control.end(script)` 的写入**被否决：启动器在就绪池中等待、尚未被任何命令使用时，其他管道也会以同样方式失败。**交出启动器前检查它是否存活**被否决：启动器仍可能在检查与写入之间结束。

## 影响

在接收命令之前或接收时结束的启动器，会让该命令以启动器的退出状态结束，而不是让 Host 退出。该命令不会运行；调用方看到它退出，与任何在启动时被杀死的进程相同。
