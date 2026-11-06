# Agent Note: 不 fork Host 即启动命令

Status: implemented

[English](2026-11-06-subprocess-executor.md) | 中文

## 问题

在 Linux 上，Node 的 `child_process.spawn` 会 fork 调用进程，而 fork 会在子进程 `exec` 之前复制父进程的页表。托管 Host 保存所有账户的会话、记忆与同步状态，实测为 1.2 GB；从这样大小的父进程 spawn，每条命令耗时 38.7 毫秒，其中 Host 的事件循环被阻塞 38.9 毫秒。每条 bash 命令（无论是否在监狱中）都要付出这一代价，而在此期间每个账户的请求都要等待，因此成本随 Host 的大小和运行命令的人数一起增长。

## 决策

`@aeven/subprocess-executor` 是一个 `ctx.subprocess` 提供方，它扩展 `avn-subprocess-local`，只替换其可注入的 spawner。Host 只在加载时 fork 一次，用来启动一个小型辅助进程。辅助进程维护一个空闲启动器池：每个启动器都是一个 detached 的 `bash`，阻塞在从描述符 3 读取脚本上。辅助进程通过 IPC 把每个启动器的 stdin、stdout、stderr 和控制管道作为打开的描述符交给 Host，并报告其 pid。启动命令时，Host 取一个就绪的启动器，把 `cd -- <cwd> && exec /usr/bin/env -i <environment> <program> <args>` 写入控制管道并关闭它；启动器随即成为该命令，保留相同的 pid 和进程组。Host 返回一个形似 ChildProcess 的代理：其 pid 按本地运行时的要求立即可得，输出通过交接来的管道到达，退出状态由辅助进程报告。信号和进程树终止仍像以前一样由 Host 发往进程组。池无法服务的调用（没有就绪的启动器、继承的流、不可执行的程序、不存在的目录）退回普通 spawn，因此 spawn 失败保留其原有错误。

托管补丁在 POSIX 主机上以八个启动器的池挂载它，取代本地运行时。

## 备选方案

拒绝像 E2B 适配器那样通过 IPC 重新实现 `ctx.subprocess`：这会重复本地运行时的收集、溢出和拆除逻辑，而且远程 spawn 无法同步给出 pid。拒绝用原生的 `posix_spawn` 或 `vfork` 绑定替换 `spawn`：为一个调用引入新的原生依赖。使用 `process.execve` 的 Node 启动器也可行，但每个空闲启动器要占用数十 MB；一个等待中的 `bash` 只占几 MB。

## 影响

启动命令不再阻塞 Host：在托管机器上，从 1.2 GB 的父进程启动一条命令耗时 3.2 毫秒而非 38.7 毫秒，最坏的事件循环停顿从 38.9 毫秒降到 0.8 毫秒。终端仍从 Host 分配 PTY。避免每条命令都重新导入的预加载 Python 解释器是单独的工作。

## 验证

在 macOS 和托管机器上，于 Cordis 上下文中从源码运行该提供方，检查了收集的 stdout 与 stderr 及退出码、工作目录与环境及 PATH 查找、管道 stdin、中止时的进程树终止、缺失程序的回退，以及对 3 MiB 输出的有界收集，并从 1.2 GB 的父进程测量了两种运行时。类型检查和构建通过。
