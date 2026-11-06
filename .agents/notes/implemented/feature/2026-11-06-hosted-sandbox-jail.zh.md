# Agent Note: 托管版 Aeven Web 的按账户命令监狱

Status: implemented

[English](2026-11-06-hosted-sandbox-jail.md) | 中文

## 问题

托管版 Aeven Web 不运行任何命令，因为 Host 的磁盘和进程属于它服务的所有账户。人们仍然想要能运行代码的助手所提供的能力：用 pandas 分析表格、画图、用 Python 或 Node 生成文档。本地沙箱无法在共享 Host 上提供这些：它的 bwrap 和 Landlock profile 让整个磁盘可读、网络开放，没有工作区的对话写入同一个共享的 `chats` 文件夹，而经批准升级到 `danger-full-access` 会直接在 Host 上运行。

## 决策

`@aeven/sandbox-jail` 是第二个 Linux `ctx.sandbox` 后端。每条受限命令都在 bubblewrap 下运行，使用全新的 user、mount、PID、IPC、UTS、cgroup 和 network 命名空间，并带有 `--disable-userns`。监狱根目录只包含配置的只读系统路径和运行时镜像、调用账户的文件夹，以及有大小上限的私有 `/tmp` 和 `/dev/shm`。Landlock launcher 在监狱内再次限制该视图，一个 `/bin/sh` 步骤在 bubblewrap 启动前把命令移入 `<unit>/jail/acct-<account>`，因此 CPU、内存和进程限制既按账户也按总量生效。工作区根目录位于账户根目录之外或跨越两个账户时抛出 `SANDBOX_UNAVAILABLE`。

`avn-working-directory` 新增 `managedRoot`：在 `folders: false` 时，会话获得 `<managedRoot>/<owner>/workspaces/<workspace id>`，未归入任何工作区时获得 `<managedRoot>/<owner>/chats`。`avn-sandbox-policy` 新增 `ceiling`：高于它的已批准升级会被拒绝，高于它的会话覆盖解析为它，`avn-tool-bash` 只提供其范围内的升级目标。两者默认保持以前的行为，因此桌面版和 web 组合不受影响。

托管补丁在 `AVN_HOSTED_SANDBOX=1` 时挂载监狱、托管文件夹、`workspace-write` 上限和 bash 工具，且从不挂载本地沙箱。命令没有网络，无法安装软件包；`/opt/aeven-sandbox` 中的镜像提供带有数据、绘图、机器学习和 Office 文档库的 Python（字节码已预编译），以及一组 Node 库。

## 备选方案

每个账户一个远程沙箱（E2B）或每个账户一个 gVisor、Firecracker 沙箱隔离更强，但每条命令增加 0.1–1 秒或每个沙箱额外占用内存，还要加上网络往返或运维第二个运行时。在托管机器上测量，bubblewrap 加 Landlock 每条命令约增加 5–6 毫秒，对运行中的代码没有可测量的开销，因此监狱保持了高密度，同时这些后端仍可通过同一 seam 使用。

本步骤拒绝像 E2B 系列那样用按账户的执行世界替换 `ctx.fs` 和 `ctx.subprocess`：bash 消费方已通过 `ctx.sandbox` 包装每条命令，因此在那里换一个更严格的后端即可覆盖 shell，工具无需改动，而文件工具在托管 Host 上保持禁用。

拒绝在本地提供方上加一个更严格的 profile 开关：本地 profile 承诺的是单一所有者的视图，一个开关会让一个包承载两套安全模型。

测量后拒绝每条命令创建一个 cgroup：创建并删除一个约耗时 13 毫秒并损失三分之一的启动吞吐量，而每个账户一个组只创建一次，还能带来按账户的公平性。

## 影响

托管会话可以在其账户文件夹中运行 bash、Python 和 Node，文件在命令和对话之间保留。监狱与 Host 共享内核，因此内核提权会到达整台机器；托管机器上还运行着 API 和数据库。每条命令仍启动自己的解释器并由 Host 进程派生；预 fork 的解释器和单独的执行器进程尚未实现。托管的 `AVN_*` 变量不会到达监狱中的命令，文件工具、Files 侧栏和交付物保持禁用。

主机需要 bubblewrap、允许 bubblewrap 创建 user 命名空间的 AppArmor profile、在部署 checkout 中构建的 Landlock launcher、运行时镜像，以及带有 `Delegate=yes` 和 `DelegateSubgroup=host` 的 unit。

## 验证

在托管机器上，插件以非特权身份在具有相同委派的临时 unit 中运行。pandas、matplotlib、带 joblib 的 scikit-learn、Office 文档库和 Node 库都能运行，文件在命令之间保留。读取其他账户的文件夹、Host 的 home 和 checkout、`/etc/shadow` 以及 `/home` 均失败；写入 `/usr` 和镜像失败；Host 的回环端口、互联网和元数据地址均不可达；pip 不存在；主机进程和嵌套 user 命名空间不可用；400 次 fork 触及进程限制；3 GB 分配在 2 GB 账户限制处被终止；不在单一账户内的根目录被拒绝。类型检查和构建通过。
