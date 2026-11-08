# Agent Note：加固托管沙箱，防止单个账户滥用

Status: implemented

[English](2026-11-08-hosted-sandbox-abuse-hardening.md) | 中文

## 问题

托管 Aeven Web 为公众运行命令，因此单个账户不得拖垮机器或其他账户。对监狱的审查发现了四条途径：

- 超出内存尾部的命令输出会 spill 到 Host 临时目录中的文件，每个流最多 64 MiB，保留到 Host 退出。在 pink 上，该目录位于与 Mongo 共享的 45 GB 根盘，不受任何账户的磁盘配额约束，而且监狱中的命令本就读不到这些文件。
- cgroup 限制了 CPU、内存与进程，却没有限制磁盘 I/O，因此一个账户就能占满 Host 与 Mongo 使用的磁盘。
- 共享的 Python zygote 使用 `select()`，描述符超过 1023 即失败，且没有兜住 accept 与 fork 的错误。在 pink 上，来自一个监狱的 1150 个空闲连接以 `ValueError: filedescriptor out of range in select()` 终结了它；一分钟内这样结束五次后，它会一直停止到 Host 重启，所有账户的 Python 又要重新支付导入开销。
- 系统调用过滤器允许所有套接字族，包括 `AF_ALG`、`AF_VSOCK` 与审计 netlink，受限命令从不需要这些内核代码。

## 决策

- `avn-bash-local` 新增 `spillOutput`（默认 true）；托管补丁将其关闭，因此长输出只保留内存尾部，并告诉模型把输出重定向到工作目录中的文件以读取全部内容。
- `avn-sandbox-jail` 的限制新增可选的 `ioMax`，写入容纳 `accountsRoot` 的整块磁盘的 `io.max`，并启用 `io` 控制器。容纳账户的磁盘同时存放 Mongo，在 pink 上顺序写入约 165 MB/s、读取约 309 MB/s，因此托管补丁给所有监狱合计写 40 MiB/s、读 80 MiB/s、写 1000 与读 3000 IOPS，约为磁盘的四分之一；每个账户写 10 MiB/s、读 30 MiB/s、写 300 与读 1000 IOPS。在 pink 的 `loop2` 上以写 50 MiB/s、读 100 MiB/s 的限制实测：直接写入 55.6 MB/s，带 fsync 的缓冲写入 33.9 MB/s，直接读取 111 MB/s，不限速时为 2.3 GB/s。
- zygote 改用 epoll 等待；单个账户超过 8 个、或总计超过 256 个等待中的连接时回答 `F`；规划或 fork 失败时回答 `F`；任何单个请求的错误都不会使其结束。连接在运行开始前结束时，shim 运行真实解释器。反复结束的 zygote 在五分钟后重启，而不再一直停止。在 pink 上，新 zygote 承受了一个账户的 3000 个连接，同时另一个 cgroup 中的调用方在 0.4 ms 内得到应答。托管 zygote 自身的组限制为四个 CPU。
- 过滤器只允许 `AF_UNIX`、`AF_INET`、`AF_INET6` 与路由 netlink，拒绝 `AF_UNIX` 之外的 socketpair，并编译为二叉树。Python 循环中的一次系统调用耗时 291 ns，此前为 279 ns。

## 备选方案

在命令结算时删除 spill 文件对托管 Host 被否决：那里的模型读不到 Host 临时目录，这些文件对谁都没有用。spill 到账户文件夹会计入配额，但需要执行器并不知道的逐调用目录。

`io.weight` 被否决：它只有在 BFQ 调度器或配置了 `io.cost` 时才生效，而 `io.max` 适用于任何块设备，包括容纳账户的 loop 设备。

## 影响

更新 seccomp 过滤器或 shim 后，需要在重启前于 Host 上重新构建它们（`seccomp-filter.c`、`install-python-zygote.sh`）。inotify 实例等按用户计的内核计数仍通过同一个沙箱用户由所有账户共享，共享内核仍是抵御提权的屏障；两者都记录在 `avn-sandbox-jail` README 的限制中。
