# Agent Note: Host 关闭：管道拥有自己的描述符

Status: implemented

[English](2026-10-30-host-shutdown-descriptor-ownership.md) | 中文

## 问题

在 Windows 11 arm64 上（Aeven 0.3.28-alpha，随附的 Node.js 24.17.0），一条 `shutdown` 消息会让桌面 Host 进程继续存活。此后该进程既不响应它的 IPC 通道，也不响应它的 HTTP 服务器，而 `stop()` 里 15 秒的拆卸期限从未打印：两者都位于被阻塞的那个线程上。

对构建产物入口插桩后可以看到，拆卸到达 `requestPipe.destroy()` 之后再也不返回。下一条语句是 `closePipeDescriptor(DESKTOP_REQUEST_PIPE_FD)`，即对继承来的请求管道执行同步的 `closeSync(3)`。该描述符上仍有一个 libuv 读取未完成，因此从 JavaScript 线程关闭它会在 Windows 上把线程卡住。

Electron 外壳等待子进程退出 10 秒，发送 `SIGTERM`，再等 5 秒，然后 `SIGKILL`（`DesktopHostProcess.stop()`），所以退出应用要花 15 秒，而下一次启动会与垂死的 Host 竞争，此时 `claimOrAttachHost` 最长轮询运行时锁 30 秒。

## 决策

读取流与写入流拥有各自继承来的描述符。`createReadStream` 与 `createWriteStream` 只接收 `fd`，保留 Node 默认的 `autoClose`，而 `closePipeDescriptor` 不再存在：拆卸时销毁请求流，并结束和销毁响应流，于是 libuv 会在各自的未完成请求结束后关闭每个描述符。

## 曾考虑的替代方案

**保留 `closePipeDescriptor`，在读取结算之后再调用它。** 不予采纳：流上的 `destroy()` 在 libuv 完成未完成请求之前就返回，因此没有任何回调能说是描述符已空闲；从 JavaScript 线程发出的 `closeSync` 仍会与读取竞争，并可能像之前一样卡死。

**让描述符保持打开，由进程退出时关闭它。** 不予采纳：在 Windows 上，继承来的管道句柄会让子进程继续存活，于是外壳的期限到期，退出要付出一整段 15 秒的代价，正是本笔记所描述的。

**把描述符交给流自身的关闭路径。** 采纳：`autoClose` 在 libuv 的请求完成内部调用 `close`，那是唯一知道未完成读取已结束的位置。

## 后果

- 关闭不再卡死：标记追踪在 `shutdown` 之后走到每一个拆卸步骤（撤下已公布的 URL、释放客户端租约、销毁请求管道、dispose（资源释放）该 fiber、释放启动锁、结算各次运行、断开 IPC）。
- Node 自身的退出路径在这种组合中仍不返回：`process.exit()` 与 `process.reallyExit()` 都被执行到，但两者都没有终止进程，而 `process.kill(process.pid, 'SIGKILL')` 在 `shutdown` 之后 2.5 秒结束它。koffi 与 sharp（libvips）在隔离环境中都能正常退出，也没有注册任何 `exit` 监听器，因此阻塞点在原生进程拆卸内部，需要单独调查。外壳 10 秒 + 5 秒的等待仍然覆盖它，这就是退出要花 15 秒而不是永久挂起的原因。
