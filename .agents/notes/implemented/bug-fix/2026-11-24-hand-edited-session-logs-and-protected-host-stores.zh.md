# Agent Note：手动编辑的会话日志不再重放其提示，Host 的存储受到保护

Status: implemented

[English](2026-11-24-hand-edited-session-logs-and-protected-host-stores.md) | 中文

## 问题

一个新桌面账户上的 agent 直接向 `~/.aeven/sessions` 写入了 22 个会话日志，并为修正标题和校验错误把它们重写了约十次。四个产品缺陷把这件事变成了失控的轮次、无法启动的 Host，以及不起作用的停止按钮。

- **同步重新提出被重写日志中的每个提示。** 被 agent 重写的日志不再与本设备已发布的历史一致。另一台设备重命名该会话时，折叠会重写本地日志；由于重写起点在本设备的认领基点之后，被丢弃尾部中的每条用户消息都作为新提示入队。这些提示带有新的请求 id，已回答检查无法识别它们，在被停止之前，17 个会话中共运行了 372 个轮次。
- **一个损坏的日志让 Host 停止。** 当日志的第一个 Zstandard 帧包含的内容多于头部行时，`readArtifactHeader` 抛出异常，整个列表请求被拒绝，导致 workspace 插件加载失败。
- **停止操作无法到达另一台设备上的轮次。** `cancel` 和队列编辑只有在 `runnerOf` 找到存活的运行者条目时才转发。运行被重放轮次的设备没有发布任何条目，于是停止落到本地路径，并以 `session/not-found` 失败。
- **没有任何机制阻止 agent 写入 Host 的存储。** 经批准升级到 `danger-full-access` 后，bash 不受限制地运行，文件工具在该模式下返回的目标也没有围栏。

## 决策

- `session-sync` 的 `rewrite()` 只在被接受的事件属于另一台设备的认领时才重新提出被丢弃的提示。在本设备自己的认领下出现分歧，说明存储的日志在发布后被磁盘上的修改改变；日志会恢复为被接受的历史，且不会重新发送任何提示。
- `session-persistence-jsonl` 将头部失败归类为 `CorruptSessionHeaderError`；列表会跳过此类日志并记录警告，按 id 加载它时仍会带着原因失败。
- `SessionHandoff.turnElsewhere` 回退到索引条目的 `running` 标记和 `writer` 设备；当本机没有附加的 agent 时，`session-controller` 通过它路由 `cancel` 和 `updateQueue`。过期的标记只会让一条转发输入在未应用的情况下过期。
- `sandbox-policy` 新增 `protectedRoots`，基础 bundle 将其设置为 `$AVN_HOME` 下 Host 的存储（`sessions`、`storages`、`accounts`、`session-query`、`identity`、`keys`）。文件工具在所有模式下拒绝写入这些目录，Seatbelt 配置以针对它们的拒绝规则结尾，bwrap 以只读方式挂载它们，`SandboxProvider.protect` 在 macOS 上把 `danger-full-access` 的 bash 包装进一个只含这些拒绝规则的默认允许配置。

## 考虑过的替代方案

- **重新提出提示时更宽松地匹配请求 id。** 未采用，因为被重写的日志为旧提示带来新的 id；只有认领能区分输掉的竞争与被编辑的文件。
- **让 `runnerOf` 本身信任索引的 `running` 标记。** 未采用，因为重命名和移动也会查询它，崩溃设备留下的标记会无限期阻塞这些操作；停止和队列编辑能容忍过期标记，因为它们转发的输入会过期。
- **拒绝提及 `~/.aeven` 的升级请求。** 未采用，因为 agent 曾通过脚本文件写入修改，而命令文本从未出现该路径。

## 后果

- Landlock 无法从可写根目录中划出受保护的根目录，Linux 和 Windows 上的完全访问 bash 仍不受限制地运行。
- agent 仍可以用 `pkill` 停止自己的 Host；防护需要单独的包。
- 会话无法跨设备删除，也没有受支持的会话导入，因此被要求导入聊天的 agent 仍没有产品路径。
