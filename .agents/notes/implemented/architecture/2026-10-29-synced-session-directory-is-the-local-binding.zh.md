# Agent Note: A synced session's directory is this device's workspace binding, not its recorded path

Status: implemented

[English](2026-10-29-synced-session-directory-is-the-local-binding.md) | 中文

## Problem

`SessionHeader.cwd` 以及每一条 `session/cwd` 事件记录的，都是写入它们的设备所使用的绝对路径，而所有 shell、文件、搜索、LSP 和沙箱消费方都从这些值解析目录。与此同时，工作区只同步身份：`@aeven/workspace` 通过账户的同步文档发布工作区的标题和顺序，从不同步其目录，因此到达另一台设备的工作区在该设备绑定自己的文件夹之前一直是 `remote`。

会话会同步。所以在一台机器上创建的对话会带着第一台机器的目录（在头部，也在日志里）到达另一台机器，而接收方的工具就会作用在那个路径上。这个失败的后果不是表面问题：路径可能不存在，于是每次相对路径的工具调用都失败；也可能存在但指向一个无关目录，于是会话读写错了文件。沙箱的 `workspace-write` 边界由同一个值推导而来，所以写入限制的根目录也是错的。

交接让它变成了持久问题。`claimRunnerAccount()` 通过调用 `WorkingDirectoryService.enter()` 来套用本地工作区，而那会追加一条 `session/cwd` 事件——把本机的绝对路径写进一份会同步回所有其他设备的日志。

## Decision

工作区身份是可移植的事实；目录属于设备本地。`@aeven/working-directory` 从工作区注册表解析会话的本地目录，而不是读取记录下来的路径；在没有本地绑定的地方，记录路径从不被使用。

`WorkspaceRegistry` 公开解析器所需的两个读取：`placeSession(sessionId)` 返回 `{ state: 'filed', workspace }`、`{ state: 'pending', home }`（导入的会话，其工作区尚未到达）或 `{ state: 'unfiled' }`；`replicated(sessionId)` 报告该日志是否来自另一台设备。

`WorkingDirectoryService.local(session)` 回答本设备实际作用的目录与根：

| 会话 | 本地目录 |
|---|---|
| 不记录任何目录（无工作区的聊天） | `absent` |
| 工作区尚未到达本设备 | `unresolved('workspace-not-here')` |
| 工作区已在本设备但没有目录 | `unresolved('workspace-unbound')` |
| 工作区已在本设备绑定，日志由另一台设备写入 | 该绑定，同时作为目录与根 |
| 工作区已在本设备绑定，日志由本机写入 | 记录下来的目录与根 |
| 本设备没有工作区认领它 | 记录下来的目录与根 |

`of()` 与 `rootOf()` 返回本地目录与根，或返回 `undefined`；它们绝不返回另一台设备的路径。`resolve()` 直接拒绝，而不是回退到进程目录。两个导出的辅助函数把这条规则带给消费方：`sessionDirectory(ctx, session)` 与 `sessionWorkspaceRoot(ctx, session)`，当工作区在本设备没有文件夹时抛出 `WorkingDirectoryUnavailableError`，只有在插件完全未组装时才回退到 `header.cwd`。本进程自己进入的目录——`change`、`enter`、`enterVerified`——对复制来的会话优先于绑定，并且只存活于本进程，因为日志已经为下一个进程记下了这次移动。

交接不写入任何东西。`claimRunnerAccount()` 认领会话后解析本地目录，若没有则用 `workspace/no-local-directory` 拒绝（详情携带会话、工作区与原因）；它不再调用 `enter()`。本地目录在执行时推导，因此没有需要记录的东西。

### What stays on the header

用于**比较**或**标注**会话的值仍然读取 `SessionHeader.cwd`，因为"这个会话来自哪个工作区"的正确答案仍是记录下来的目录：工作区成员资格与准入、ACP 会话元数据、会话引用排序、程序性记忆的作用域，以及注册表自身的 cwd 校验。这次改动关乎工具作用在哪里，而不关乎会话是什么。

## Alternatives considered

**同步目录路径。** 通过账户文档发布工作区路径会让每台设备读到同一个绝对路径，而这正是要避免的结果：两台机器无法共享同一个拼写，最后写入者会覆盖另一台的绑定。

**在到达时重写会话头部。** 它能让记录的路径在本地为真，但会摧毁可移植的记录，需要对既有日志做迁移，并破坏头部不可变的约定——而其他设备上的副本仍然要各自重写一次。

**当记录路径恰好存在时回退使用它。** 便宜且错误：两个拼写相同的目录不是同一个目录，一次巧合的匹配就会让会话作用在无关文件上。存在性也不是归属的证据，所以规则选择拒绝。

**让 `of()` 返回 `undefined`，由每个消费方保留它的 `?? session.header.cwd`。** 这正是本次改动所取代的状态：能力回答"没有本地目录"，消费方把外来路径复活，缺陷就在每一个未迁移的调用点存活下来。

**在工作区记录之外再加一个本地覆盖数据库。** 工作区记录本身就是本地绑定；第二个存储必须与它保持一致。

## Consequences

- 同步的对话在第二台设备上以该设备自身的工作区文件夹打开并运行，绝不使用第一台设备的路径。
- 到达时没有目录的工作区会以类型化错误拒绝本地文件与 shell 工作，并在提示词侧告诉模型先询问使用哪个文件夹，而不是在缺失路径上失败或在无关位置写入。
- `@aeven/working-directory` 以可选方式读取 `@aeven/workspace`：没有注册表的组装（子代理、快照回放、SDK）继续从头部解析，而在那里不会有同步会话到达。
- 复制来的会话被认领时不写入日志，因此交接不再把某台机器特有的路径带到其他设备。
- 重新链接已移动的文件夹，以及携带复制会话曾工作的子目录，不属于本决定；两者都在包的 README 中记录为当前限制。
- 解析器在每次目录读取时调用 `placeSession`，它会遍历注册表的工作区列表。这在工具路径上是每次调用的开销，若在性能分析中显现，可以缓存。
