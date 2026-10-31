---
description: "会话工作目录与工作区根作为被记录的能力：头部 cwd 被可重放的 session/cwd 变更覆盖，并由每个文件、搜索、shell 与沙箱消费方解析为本设备为该工作区做的绑定。"
kind: "package-reference"
---

# @aeven/working-directory

[English](README.md) | 中文

会话的工作目录作为一个被记录的能力。每个解析相对路径的工具都向该服务询问，而不是读取会话头部。

## 概述

`@aeven/working-directory` 为整个 harness 回答两个问题：这个会话现在在哪个目录里工作，以及它可以写入哪个工作区？会话在记录于不可变头部元数据的目录中创建，但工作会移动——进入子目录、新的检出、worktree——因此服务把最后记录的 `session/cwd` 折叠到该头部之上，并相对于结果解析相对路径。文件、搜索、shell 与 LSP 工具向它询问工作目录，沙箱策略向它询问工作区根，`@aeven/tool-working-directory` 把目录暴露给模型。凡是会话目录必须变化、并且要在恢复、fork 与重放之后仍然成立的地方，都使用它。

这些记录的路径指向写入它的那台设备上的目录。同步账户的会话会到达其他设备，其中的路径可能并不存在，也可能指向拼写相同的无关目录，因此服务改为对照本地工作区注册表解析：可移植的事实是共享的工作区身份，目录只是本设备为它做的绑定（[决定](../../../.agents/notes/implemented/architecture/2026-10-29-synced-session-directory-is-the-local-binding.zh.md)）。

## 目录

- [约定](#contract)
- [操作](#operations)
- [消费方](#consumers)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="contract"></a>
## 约定

会话在某个目录中创建，而该创建路径是不可变的头部元数据（`SessionHeader.cwd`）。工作会移动：进入子目录、进入新的检出、进入 worktree。因此生效的目录是

```
recorded = last logged session/cwd ?? session.header.cwd        // written where the session ran
service.local(session) = local binding for the session's workspace, when this device has one
```

`session/cwd` 携带绝对目录，会话移入另一个工作区时还携带其 `root`。它只进日志、非 surface，每个字段按最后一条重放，因此恢复与 fork 都会还原日志记录的内容。切换到子目录不改变根，因此永远不会缩小会话可写的范围。

解析读取两个事实：记录下来的目录与其根，以及 `ctx.workspaceRegistry.placeSession(sessionId)` 说出的会话在本机所处的位置。由本设备写入的会话保留其记录的目录，因为那正是它的工作所在：子目录、检出或 worktree。从另一台设备复制过来的会话，在本机为其工作区所做的绑定中行动，因为记录的路径属于写入它的机器。工作区到达本设备但没有目录、或尚未到达的会话，解析不出目录，并会说明原因；记录路径绝不会顶替缺失的绑定。完全没有记录目录的会话（没有工作区的对话）在这里也没有目录，`of()` 返回 `undefined` 而不是凭空造一个。

`workingDirectory` 投影单元为客户端折叠同一批事件。当本机目录生效时，服务在每次请求前添加一行运行时上下文：`Current working directory: "<path>". Relative paths in file, search, and shell calls resolve against it.`；该目录已不存在时则改为说明这一点的一行。本机无法承担该会话的工作区时，该行会说明这一点，并请模型自己选定一个文件夹，而不是猜测。

<a id="operations"></a>
## 操作

- `local(session)` —— 本机目录与根；本机没有该会话工作区的文件夹时返回 `{ state: 'unresolved', reason }`（`workspace-unbound`、`workspace-not-here`），会话没有记录目录时返回 `{ state: 'absent' }`。不访问文件系统。
- `of(session)` / `rootOf(session)` —— 本机目录与工作区根，或 `undefined`；读 `local()` 可区分拒绝与会话本身没有记录。
- `resolve(session, path)` —— 绝对路径做规范化；相对路径相对于本机目录解析。工作区在本机没有文件夹的会话会抛出 `WorkingDirectoryUnavailableError`，而不是相对于进程目录解析。不访问文件系统。
- `change(session, target)` —— 解析、要求目标存在且是目录、追加 `session/cwd`、返回绝对路径。空目标、缺失路径或普通文件会抛错，错误信息点出该路径。目标已在生效状态时不追加任何事件。
- `enter(session, target)` —— 与 `change` 相同，并且该目录同时成为工作区根。`enterVerified(session, path)` 在子级创建窗口内，对调用方刚创建的目录同步地做同样的事。
- `inherit(child, parent)` —— 把父级记录的目录与根复制到子级日志上，使委派的子级从父级所在的位置开始。通过本机绑定工作的父级不记录任何内容：子级自己的头部已指向本机的目录，复制父级记录的路径只会把另一台机器的拼写带进子级的同步日志。

<a id="consumers"></a>
## 消费方

消费方调用两个导出辅助函数之一，而绝不直接读取头部：

- `sessionDirectory(ctx, session)` —— 文件、搜索、shell、LSP、媒体、终端、钩子或 subagent 调用所在的目录。
- `sessionWorkspaceRoot(ctx, session)` —— 限制写入的工作区根，由 `@aeven/sandbox-policy`、工作区文件浏览器与 `@` 文件引用使用。

两者都会在会话的工作区没有本地文件夹时抛出 `WorkingDirectoryUnavailableError`，且只在本插件根本没有被组合时回退到头部：这种组合没有工作区注册表，因此也没有同步会话。shell 工具（`tool-bash`、`tool-bash-persistent`、`tool-pwsh`、`tool-pwsh-persistent`）、文件工具（`tool-fs`）、`glob`/`grep`（`tool-fs-search`）、`tool-lsp`、`tool-media`、`bash-edit-guard`、终端面板、工作区文件浏览器、项目指令发现、项目上下文、钩子与 Codex subagent 提供方都通过它们解析目录。在另一个目录中启动的持久 shell 会在下一条命令时重启。

`@aeven/tool-working-directory` 把同一能力以 `working_directory` 暴露给模型；`@aeven/worktrees` 用 `enter()` 移动会话，`@aeven/subagent` 用 `inherit()` 安置子级。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **重新链接的工作区按锚点转换记录路径。** 工作区的文件夹移动且工作区被重新链接后，记录在旧目录下的会话会解析到新目录中的同一位置；不在任何锚点之内的记录目录按原样使用，因此本机从未得知的移动仍会解析到陈旧的路径。
- **复制的会话在其工作区根处运行。** 把会话在工作区内的具体位置记录为工作区相对路径尚未实现，因此从另一台设备复制来的会话在本机绑定本身中行动，而不是它上次使用的子目录。
- **本机迁移不可移植。** worktree，或会话在其工作区之外进入的目录，属于本机自身；这一移动对复制的会话存在于本进程，对由本设备写入的会话则存在于日志。
- **身份读取仍留在头部。** 会话分组、会话引用排序、ACP 会话元数据、程序性记忆范围，以及工作区注册表自身的 cwd 校验，比较的是记录的目录而不是在其中行动，因此它们刻意继续读取 `session.header.cwd`。
- 没有目录栈：`change` 是一个最后写入者胜的单一值，离开目录的模型通过指出上一个路径返回。
- `change` 校验目标存在，但不把它限制在沙箱根内。受限组合必须在拥有限制的策略中拒绝根外目标。

<a id="dev-note"></a>
## 开发备注

不发布 invariant 配套文件，因为它唯一拥有的关系——投影与 `of()` 一致——在单元规格里对真实会话日志进行观察，不存在可能与之偏离的独立观察。

`of()` 返回 `undefined`，而不是回退到进程目录，因此没有 `cwd` 创建的会话是明确未定的，而不是悄悄继承宿主恰好启动的位置。`resolve()` 对同一情形同样拒绝，而不是相对于进程目录解析相对路径。

消费方使用 `ctx.get('workingDirectory')` 而非声明的注入，因为该插件在组合中是可选的：没有它的 profile 保持头部行为，而不是加载失败。
