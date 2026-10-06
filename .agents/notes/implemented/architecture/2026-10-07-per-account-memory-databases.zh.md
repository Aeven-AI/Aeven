# Agent Note: 每个账户一个 MemOS 数据库

Status: implemented

[English](2026-10-07-per-account-memory-databases.md) | 中文

## 问题

`@aeven/memory-memos` 在 `memory/data/memos.db` 下用一个 MemOS 核心运行一个数据库，只按 MemOS profile 区分账户。每次读取都经过 MemOS 的可见性过滤，而它也放行没有所有者的行、所有者为 `unknown` 的行，以及以 `public` 或 `hub` 共享的行，因此隔离只在任何行都不进入这些状态时才成立。删除或导出某个人的记忆意味着过滤一个共享文件，而 MemOS Viewer 无需登录即提供整个文件。

## 决策

每个账户都有自己的 MemOS 核心和数据库，位于 `accounts/<账户 id 的 sha256>/memory/data/memos.db`，与 `@aeven/host-account-integrations` 存放连接器和技能的账户子树相同；`@aeven/home-paths` 为此导出 `accountDirectoryName` 和 `accountHomePath`。`OwnerCores`（[`src/cores.ts`](../../../../packages/memory/memory-memos/src/cores.ts)）在账户第一次记忆操作时打开核心，并发的首次使用共享同一次打开，失败的打开会被遗忘，并随提供者关闭所有已打开的核心。`MemosMemory` 的每个操作都解析其作用域所有者的核心；行仍带有 `user-<owner>` profile，编辑和删除仍会检查它。提供者的 `home` 保存所有核心共用的 `config.yaml`，新增的 `accounts` 字段指定按账户划分的根目录；每个账户的 MemOS 路径由该根目录构造，而不经过 `resolveHome`，因为后者的 `MEMOS_HOME` 覆盖会让所有账户指向同一个文件。

嵌入模型在 MemOS 中是模块级单例，因此所有核心共享同一份已加载副本。每个打开的核心各自增加一个 SQLite 连接、一个最多 20,000 个向量的嵌入缓存和三个后台定时器。

启动时，`splitSharedMemory`（[`src/migrate.ts`](../../../../packages/memory/memory-memos/src/migrate.ts)）迁移早期版本的共享数据库：对每个 `user-*` profile，用 `VACUUM INTO` 复制文件，删除其他 profile 的所有行以及由此遗留的链接和重试行，优化 FTS5 索引，执行 vacuum，并把副本重命名到该账户的位置。所有账户迁移完成后，共享文件改名为 `memos.db.split`；已有数据库的账户保留自己的数据库，失败时共享文件留待下次启动。该拆分会在第一个正式发布标签时删除。

MemOS Viewer 选项已移除：一个 Viewer 只能服务一个核心，账户通过记忆管理器访问自己的记忆。

## 考虑过的替代方案

**每个账户一个 Aeven home。** 它能隔离所有类型的状态，但同一 home 上的两个 Host 无法协调，同一个人在两台设备上会得到两份历史（[按账户隔离](2026-09-30-per-account-isolation-on-a-shared-host.zh.md)）。

**保留一个数据库并收紧 MemOS 的可见性过滤。** 这需要对收录的核心做越来越多的修改，而隔离仍然只是每个查询的一条 `WHERE` 子句。

**保留共享数据库，让账户从空开始。** 每个现有用户都会在升级时失去记忆。

## 影响

一个账户的记忆就是一个可删除或导出的目录，其他账户的行不在它的核心所打开的文件中。Host 启动后，账户的第一次记忆操作要在其召回期限内承担核心打开的开销。不属于任何账户的 profile 的行只保留在 `memos.db.split` 中。收录的 MemOS `server/` 目录树和 `viewer/dist/` 不再有使用者。
