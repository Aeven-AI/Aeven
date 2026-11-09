# Agent Note: 会话同步随提交发布并逐个读取会话

Status: implemented

[English](2026-11-09-session-sync-publishes-from-commits.md) | 中文

## Problem

在托管 Web 上，一个 Host 进程服务所有账户，所有账户的会话共用一个 JSONL 会话根目录。`avn-session-sync` 为每个账户运行一个镜像，每个镜像每隔 `publishMs`（3 秒）调用一次 `listSnapshots()`，以找出有未发布事件的会话。一次列举会读取所有账户的所有会话：每个会话对另一种编码的日志进行一次失败的 `open`（会构造带堆栈的 `Error`），对日志 stat 一次、对副本标记 stat 一次，并在 `listSnapshots` 中再做同样的两次 stat。在 8 个账户、1,200 个已存储会话时，pink 在没有任何请求和中转流量的情况下测得每秒约 16,000 次 `statx`，Host 事件循环占用单核的 66–70%，因此 chat.aeven.io 上的每个页面、API 调用和流都要排在扫描之后。成本随账户数乘以全部已存储会话数增长。`fold`、`releaseLocal`、`claim` 和 `fetch` 也为检查单个会话而调用 `list()`，而账户索引的每次远端改动都会启动一次再次列举所有会话的导入。

## Decision

发布跟随提交。本进程写入的会话本来就在 `liveMs` 之后随 `session-persistence/append` 发布。发布失败的会话、镜像启动前提交的会话，以及在本设备移动到其他工作区的会话（`workspace/changed`，由 `SessionSync` 转发）会被标记；`publishMs` 之后的一次处理只读取被标记的会话。对所有已存储会话的扫描在镜像启动时、账户重新连接时以及每隔 `scanMs` 运行，用于发现其他进程写入共享会话根目录的日志。`scanMs` 默认 30 秒；`0` 只保留启动和重新连接；托管补丁设为 300 秒，因为只有 Host 写入它的会话根目录。无法读取已存储会话的扫描会在 `publishMs` 之后重试。

导入跟随索引。`sessions/index` 观察者传入其他设备改动的键，导入只读取这些会话。镜像启动、重新连接、延迟归档以及新提供的工作区注册表会运行完整导入。

`SessionPersistence` 新增 `snapshot(id)`：单个会话的 header 以及 `listSnapshots` 为它报告的修订值。服务定义用 `listSnapshots` 实现它；JSONL 后端读取上一次列举或查找发现该会话的目录，找不到时退回项目目录搜索。`avn-session-sync`、`avn-message-feedback`、`avn-subagent` 续接、`avn-acp` 恢复以及 `avn-agent-loop` 的恢复回退改用它，不再在列表中查找。

JSONL 列举对每个会话目录只读取一次，以得知日志、另一种编码的日志和 `replica.json` 中哪些存在，因此不存在的文件不产生失败调用；只有副本标记存在时才 stat 它，`listSnapshots` 复用列举读取的修订值，不再对两个文件重复 stat。不同账户的镜像在一次完整列举进行期间请求的列举共用它。导入折叠的进度检查只比较被折叠会话自身的下载状态，不再两次重新统计所有会话。

## Alternatives considered

只调大 `publishMs` 被否决：它按延迟发布的同一比例降低成本，成本仍与账户数乘以会话数成正比，而且 `publishMs` 还控制历史发布时检查发件箱的节奏。在 JSONL 后端维护内存索引、无需 I/O 即可列举的方案被否决，因为其他 Host（例如桌面 Host 旁的 ACP 或 headless 进程）可能写入同一根目录，而追加不会改变监视器能低成本利用的目录时间戳。按所有者限定的列举会为一个使用方改变 `listSnapshots` 的签名，而随提交发布已经去掉了周期性列举。在后端内部共用进行中的列举被否决，因为 `listSnapshots` 的调用方可能要求列举在其自身写入之后开始；镜像可以共用，是因为列举开始后的提交会以事件到达它们。

## Consequences

在会话都由本进程写入的 Host 上，稳态同步不读取任何会话目录；扫描成本为每个已存储会话一次目录读取和一到两次 stat，每个 `scanMs` 一次，并由各账户共用。其他进程写入的会话在 `scanMs` 而不是 `publishMs` 内发布。在本设备不再属于任何工作区的会话，会在下一次完整扫描时而不是 `publishMs` 内发布其工作区移除。对后端从未列举过的会话调用 `snapshot(id)` 会像 `findLog` 一样搜索所有项目目录。会话同步的测试替身新增 `snapshot`，其调优参数写明 `scanMs`。
