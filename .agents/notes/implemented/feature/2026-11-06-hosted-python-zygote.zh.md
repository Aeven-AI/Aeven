# Agent Note: 被隔离的 python3 在预加载的解释器中运行

Status: implemented

[English](2026-11-06-hosted-python-zygote.md) | 中文

## 问题

在托管 Web 上，被隔离命令运行的每个 `python3` 都会启动新的解释器并重新导入库：在托管机器上，`import pandas, matplotlib.pyplot` 每次调用约需 0.9 秒，而一个图表或表格任务会发起许多这样的调用。每个并发运行还各自持有这些模块的一份 40–50 MB 副本。

## 决定

`avn-sandbox-jail` 新增 `pythonZygote`。提供者在所有监狱之外、自己的 cgroup `<root>/zygote` 中启动镜像的一个解释器，并在其结束时重启（每分钟最多五次）。它只导入一次 `preload`，并在 `socketDir` 中提供一个 `SOCK_SEQPACKET` 套接字，每个监狱都以只读方式把该目录挂载在 `/run/aeven/zygote`。`host/install-python-zygote.sh` 把静态的 `python3`（及 `python`）shim 构建到 `/opt/aeven-sandbox/shim`，它在监狱 `PATH` 中排在最前。shim 发送其 argv、环境、umask、工作目录以及带编号的已打开描述符。zygote 不 fork 就规划调用；无法精确重现的调用答复 `F`，shim 便以同样的 argv 执行镜像的解释器。这类调用包括交互会话、不常见的参数、被改动的 `PYTHON*`、区域设置、线程数或 Matplotlib 变量，或未提及任何预加载模块的 `-c` 代码。否则，由一个 fork 出的辅助进程通过套接字对端的 pidfd 识别调用者，拒绝不在 `acct-*` 组中或与 zygote 共用用户命名空间的调用者，加入调用者的账户组，再加入调用者的用户、挂载、IPC、UTS、网络、cgroup 与 PID 命名空间。运行进程被 fork 进该 PID 命名空间。它丢弃所有 capability，设置 `no_new_privs`，安装启动器的 Landlock 规则（`/` 之下可读；可写 `/dev/null`、`/dev/shm`，以及监狱挂载可写根目录时的 `/tmp` 与这些根目录，从其自身挂载表读取），加载监狱的 seccomp 过滤器，然后运行程序。shim 转发信号和退出状态；运行进程随调用者的监狱一同结束。

## 考虑过的替代方案

在每个账户自己的长期监狱中运行 zygote 被否决：其 `/tmp` 与 PID 命名空间会与命令的不同，因此 `echo > /tmp/x; python3 x.py` 和 `timeout` 会失效。让所有调用都走 zygote 被否决：对于不导入重型库的代码，fork 预加载的解释器比启动一个空解释器更慢。Python 写的 shim 被否决，因为它自身的启动就会耗掉大部分收益。

## 影响

在托管机器上，`import pandas, matplotlib.pyplot` 约需 30 毫秒而不是 0.9 秒，numpy 脚本需 30 毫秒而不是 99 毫秒，普通代码保持解释器的 13 毫秒。同一 zygote 的运行共享其字符串哈希种子，并报告父进程 pid 为 0；README 列出了这一点。请求中不提供任何与安全相关的信息：命名空间、cgroup 与可写根目录都来自内核对调用者的视图。

## 验证

类型检查、lint、重复检测和构建均通过。在托管机器上一个已委派的临时 unit 中，经 zygote 的被隔离运行显示 capability 全为零、`NoNewPrivs` 为 1、seccomp 模式为 2。Host 的文件保持隐藏，系统路径只读，`/dev` 与只读模式下的 `/tmp` 被拒绝，网络不可达。`/tmp` 与调用它的 shell 共享，退出状态、`timeout`、标准输入程序、脚本、`-m`、进程替换、Matplotlib 输出、每次运行不同的随机数、线程与 `atexit`，以及 multiprocessing 的 spawn 与 fork 都与解释器的行为一致。
