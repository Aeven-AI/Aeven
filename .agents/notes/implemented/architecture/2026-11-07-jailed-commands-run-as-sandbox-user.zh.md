# Agent Note: 被隔离的命令以不同于 Host 的沙箱用户运行

Status: implemented

[English](2026-11-07-jailed-commands-run-as-sandbox-user.md) | 中文

## 问题

在托管 Web 上，每条被隔离的命令、Python zygote 和 Host 本身都以 `aeven-hosted` 运行，而这个用户拥有每个账户的对话、记忆、附件以及 Host 的凭据。监狱的命名空间、Landlock 与 seccomp 是唯一的屏障，因此借助监狱构建方式中的缺陷（无需内核漏洞）逃出监狱的命令将持有这一切。

## 决定

`avn-sandbox-jail` 新增 `commandUser`。每个启动步骤仍以 Host 的用户加入账户 cgroup、运行配额步骤、打开 seccomp 过滤器与附件，然后执行 `aeven-sandbox-exec`。该辅助程序由 `host/sandbox-exec.c` 构建，只有 Host 的组可以执行，且只持有 `cap_setuid` 与 `cap_setgid`。它 fork 出一个等待进程，后者切换到 `aeven-sandbox`、丢弃所有 capability 并启动 bubblewrap。Host 一侧的进程仍以 Host 的用户运行，因此 Host 照旧向它发送信号。等待进程把收到的每个信号经管道转发，并在管道关闭时杀死命令；父进程死亡信号做不到这一点，因为执行 bubblewrap 会改变其 AppArmor 域，从而清除该信号。bubblewrap 从账户文件系统在 `accountsPath` 的第二个挂载点（沙箱用户可以穿过但不能列出）挂载每个账户根目录，挂载位置是其在 Host 数据目录内的常规路径，而沙箱用户无法进入该数据目录。附件通过 `--ro-bind-data` 复制进来。ACL 让两个用户都能访问账户文件夹及任一方在其中创建的内容；对于 Host 以 0700 创建的文件夹，提供者会打开其 ACL 掩码。Python zygote 以沙箱用户在 `<root>/jail/zygote` 中运行，其套接字位于 `/var/lib/aeven-zygote`；`jail` 与每个账户组都允许沙箱用户的组写入 `cgroup.procs`，以便运行进程移入其调用者的组。`host/install-sandbox-user.sh` 负责准备 Host，托管补丁启用了该功能。

## 考虑过的替代方案

单独的执行机器被搁置，因为该部署只有一台机器。每条命令使用 `sudo -u` 被否决，因为它耗时数毫秒、记录每条命令，并关闭启动步骤传递的描述符。从描述符绑定账户文件夹（`--bind-fd`）被否决，因为 bubblewrap 会重新解析描述符的路径，而沙箱用户无法穿过该路径。授予沙箱用户穿过 Host 数据目录的权限被否决，因为其中对其他用户可读的文件将可按名称访问。

## 影响

逃出监狱后只持有沙箱用户的权限：能找到名称的账户文件夹，而 Host 数据目录中什么也没有。切换每条命令约耗时 1.6 毫秒。命令以 `0600` 模式创建的文件对 Host 不可读，附件每条命令都要复制一次；README 列出了这两点。

## 验证

类型检查、lint、重复检测和构建均通过。在托管机器上以 `aeven-hosted` 运行的已委派临时 unit 中，被隔离的命令以 `aeven-sandbox` 运行且没有任何 capability。它读取了自己的附件并写入了自己的文件夹，Host 也读取了它写入的内容。zygote 以沙箱用户运行 pandas，约 30 毫秒。在监狱之外，沙箱用户既不能列出 `/srv/aeven-accounts`，也不能打开 Host 的数据目录或密钥。进程组 SIGKILL、SIGTERM 以及发给辅助程序的 SIGKILL 都立即结束了命令。退出状态被如实传递。
