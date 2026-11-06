---
description: "工作区的 Git Consumer：仓库工作区随账户同步到其他设备。"
kind: "package-reference"
---

# @aeven/workspace-git-sync

[English](README.md) | 中文

## 概述

目录是 Git 工作树的工作区会作为仓库随账户同步到其他设备。持有仓库的每台设备在账户的 `workspace-git/repositories` 文档中发布去掉凭据的远程 URL、当前检出的分支、位置提示（其目录相对于主目录的路径）和大小，并把自己记录为持有者。收到没有目录的工作区的设备会在不询问的情况下获取它：

未提交和未推送的工作以工作状态检查点同步：基础提交和分支、远程没有的提交的 bundle、已跟踪更改的二进制 diff，以及 `.gitignore` 未排除的未跟踪文件的副本。另一台设备接管仓库中的会话时、每轮结束 `checkpointDebounceMs` 后以及每次检查时，设备都会写入检查点（工作树未变化时跳过），并通过传输文件夹提供。每轮的第一步之前，设备会应用另一台设备更新的检查点，最多等待 `handoffWaitMs`；等待超时后，之后的轮次只检查该检查点是否已到达而不再等待，停止该轮也会结束等待。应用时先暂存自己的更改，为检查点会丢下的提交保留一个 ref，移动分支，应用 diff，并复制未跟踪文件。克隆之后，锁文件的冻结安装通过 shell 能力运行，期间 workspace 报告 `preparing`；超过 `batteryDeferBytes` 的首次克隆在使用电池时报告 `paused`。Git 来自 [`@aeven/git-executable`](../../util/git-executable/README.zh.md)。

1. **现有检出。** 远程包含同一仓库的检出会被直接绑定，不下载。搜索按主机和路径比较远程，因此 SSH 与 HTTPS 形式可以匹配。它先查看提示所指的目录，再查看其他工作区目录的同级目录，最后在 `discoveryRoots` 下最多 `discoveryDepth` 层中查找。它只读取每个候选的 Git 配置，超过 `discoveryTimeoutMs` 即放弃。
2. **克隆。** 否则，当下载后仍保留 `minFreeDiskRatio` 比例的磁盘空间时，设备克隆到按文件夹工作区相同规则选出的目录。克隆包含子模块，并切换到发布的分支。它使用本机自己的 Git 凭据，从不提示输入。安装了 Git LFS 时会获取 Git LFS 对象。
3. **从设备复制。** 克隆失败或仓库没有远程时，设备从持有它的另一台设备复制。通过租约选出的一个持有者把包含所有 ref 的 bundle 写入传输文件夹，`ctx.fileSync` 只把该文件夹共享给请求的设备。请求方从 bundle 克隆，并把 `origin` 设为发布的远程，或将其移除。

Git 来自 `PATH` 或各平台的标准安装位置。没有 Git 的设备从不自行安装：仓库报告 `git-needed`，客户端询问用户，用户同意后发出 `workspace/files-requested`，为所有等待 Git 的仓库运行一次平台安装程序：macOS 上是 Homebrew 或 Apple 的命令行工具对话框，Windows 上是 winget，Linux 上是系统密码提示（`pkexec`）后的发行版包管理器。随后立即重试这些仓库。

环境文件是 Git 忽略、名称匹配 `envFiles.patterns`（如 `.env`）、不在被忽略目录中且在大小和数量限制内的文件。它们加密后通过账户的 `workspace-git/env/<workspace id>` 文档同步。设备只在不存在同名文件的位置写入，因此不会替换本地值，并且只写入匹配模式的路径。文件在本地变化后，设备会再次发布它。

失败的尝试会等待 `retryMs`，每 `passIntervalMs` 运行一次的检查会发布变化的环境文件并重试。检查在 Host 启动 `startDelayMs` 之后才开始；检查运行期间到达的变化共用下一次检查，因此一连串工作区变化不会每次都运行 Git。设计见[工作区文件同步 Agent Note](../../../.agents/notes/proposed/architecture/2026-11-03-workspace-file-sync.zh.md)。

每一步都会设置 workspace 的文件状态：缺少 Git 时为 `git-needed`；安装程序运行时为 `installing`；克隆或复制期间为 `syncing`；在 `copyAnswerMs` 内没有持有该仓库的设备接下复制请求时为 `waiting`；失败时为带简短原因的 `failed`：根据克隆错误输出得到 `access` 或 `network`，仓库会使磁盘剩余比例不足时为 `disk`，安装 Git 失败时为 `git-install`，其余为 `unknown`；绑定后清除状态。状态会停留在最近一次失败上，直到下一次尝试。

## 目录

- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

无，因为仓库只通过原本就读取工作区目录的文件、shell 和版本控制工具到达模型。

#### KV Cache 影响

无。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **只同步已提交并已推送的工作。** 未提交的更改和远程没有的提交会留在产生它们的设备上，直到 note 为第 3 阶段计划的工作状态检查点实现；从设备复制会带上其提交，但不带工作树更改。
- **复制不带 LFS 对象。** 从另一台设备复制的仓库不带 Git LFS 对象；远程可达后再从远程获取。
- **与文件同步分组共享** — 文件同步的其他限制统一列在[账户同步分组 README](../../sync/README.zh.md#known-limitations-and-deferred-work)中。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时 invariant：** 不发布 runtime invariant companion，因为同步文档与本地检出在每次变化时都会重新协调，而不是被独立观察。
