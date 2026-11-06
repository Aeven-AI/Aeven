# Agent Note: 托管监狱的上传文件、文件读取与加固

Status: implemented

[English](2026-11-06-hosted-sandbox-hardening.md) | 中文

## 问题

在[共享监狱命令文件](2026-11-06-hosted-sandbox-files.zh.md)之后，对托管监狱的审查发现了剩余缺口。命令无法打开上传的文件，因为模型拿到的是附件存储路径，而监狱没有挂载它。模型无法读取文件或查看它生成的图表，因为文件工具处于关闭状态。声明的输出路径仍可能通过命令创建的符号链接泄露 Host 文件是否存在，指向账户之外的 `.git` 文件会永久锁住其文件夹。共享的文件没有上限，配额辅助程序和其他 root 所有的主机文件只存在于服务器上，`ffprobe` 在 Host 上解析不受信任的上传，`vcs` 仍被挂载，生成文件行显示 Host 路径，而监狱没有系统调用过滤器。

## 决策

`avn-sandbox-jail` 新增 `sessionAttachments`：每条命令以只读方式在存储路径上挂载对话的用户消息与工具结果引用的附件，因此模型拿到的路径在监狱中可以打开。只在模型编写的工具参数中出现的附件永远不会被挂载，因此模型无法指定其他账户的内容地址。它还新增 `seccompFilter`，即由 `host/seccomp-filter.c` 生成的 BPF 拒绝列表，由加入 cgroup 的同一个 `/bin/sh` 步骤交给 `bwrap --seccomp` 读取。位于账户之外的额外可写根目录会被排除，而不是拒绝该文件夹。`host/` 存放 AppArmor profile、systemd drop-in、配额辅助程序、sudoers 规则和过滤器源码；辅助程序从 root 所有的 `/etc/aeven-sandbox/accounts-root` 读取账户根目录，在不跟随符号链接的前提下为文件设置项目 id、为目录设置继承，因此也能用于已有文件的文件夹。

`avn-tool-fs` 新增 `confineToWorkspace`，在符号链接解析后拒绝位于会话工作区之外的 `read` 与 `read_image` 目标，并新增 `mutations`，用于不注册 `write` 与 `edit`。托管版只挂载 `read` 与 `read_image`：Host 端的写入可能跟随监狱命令换入的符号链接，而读取由 `fs-sandbox` 的 `verifyReads` 验证。文件搜索保持关闭，因为它在 Host 上运行 ripgrep。

`avn-tool-bash` 对每个输出路径在命令后的解析也加以限定，以相对于工作区的路径记录共享的输出，并按调用（`shareMaxFiles`、`shareMaxBytes`）和按对话（`shareMaxSessionBytes`，按日志统计）限制共享量。`avn-document-extract-video` 新增 `probeDirectory` 与 `probeRunner`；托管版在无网络的 bubblewrap 监狱中运行 `ffprobe`，该监狱只能看到 `/usr`、库的 alternatives 和探测目录。托管版禁用 `vcs` 与 `vcs-git`。

## 备选方案

拒绝把每个被引用的附件复制到账户文件夹：这会使存储翻倍并计入文件夹配额，还要求在构建模型请求之前副本就已存在，而每条命令的只读挂载两者都不需要。用相对描述符的发布方式让 Host 端写入免于竞态被推迟；监狱中的命令写入本就没有这种竞态。按账户统计共享字节需要超出单个对话日志的状态；按对话的上限只由持久数据推导。

## 影响

托管命令可以打开上传的表格和视频片段，模型可以读取账户文件夹中的文件并查看图片，监狱中可以使用 `ffmpeg`。一个账户仍可在许多对话中各自共享到对话上限。写入仍由命令完成，文件搜索由监狱中的 `find` 与 `grep` 完成。

## 验证

在托管机器上，过滤器在 bubblewrap 中对 `unshare` 和 `ptrace` 返回 `EPERM`，而 Node I/O 与进程派生正常；探测监狱中的 `ffprobe` 报告了生成片段的编解码器、尺寸和时长；修复后的配额辅助程序为已有文件的文件夹设置了项目 id 并拒绝了 `/etc`。类型检查和构建通过。
