# Agent Note：桌面 Host 跳过未变化的记忆分片、不经 npx 运行浏览器 MCP 服务器，并在首次使用时加载动效与邮件库

Status: implemented

[English](2026-11-13-host-memory-footprint.md) | 中文

## 问题

桌面应用的进程树占用约 2.6–2.8 GB，约为 Claude Desktop 1.2 GB 的两倍，而其 Electron 进程占用少于 Claude。差额来自 Host 及其子进程：

- 每次启动时，`MemorySyncMirror.start()` 把每个已存储文档排入队列，每个文档都把完整更新历史重放进一个 `Y.Doc`，并把每一行与 SQLite 比较。在一个账户上（3,034 个文档、79,103 条已存储更新、484 MB），Host 堆在第一分钟内从 215 MB 升到 681 MB，内存占用达到 1–1.1 GB；堆缩小后 macOS 仍保留大部分页面，内存占用停在 525 MB。
- `chrome-devtools-mcp` 与 `@playwright/mcp` 通过 `npx -y` 启动。每个 `npm exec` 进程作为服务器的父进程常驻，约 180 MB，两者共 367 MB，并在首次使用时下载软件包。
- `@hyperframes/*`（及其字体工具、Babel 与 recast）、`imapflow`、`nodemailer` 与 `mailparser` 通过静态导入在 Host 启动时加载，尽管大多数 Host 从不渲染影片，也不连接邮件账户。

## 决策

- `Sync.storedDocuments(owner)` 返回每个文档的版本，`Sync.documentVersion(owner, id)` 读取单个文档的版本。Yjs 提供方的版本由存储的设备 id 与文档最新的 `doc_updates.seq` 组成；该列为 `AUTOINCREMENT`，压缩把合并后的更新作为新行插入，因此已存储状态的每次变化都产生该存储中从未用过的版本，而重建的存储产生另一个设备 id。
- `MemorySyncMirror` 在自己的 `sync_state` 中为每个已应用的分片记录一个标记：打开文档前读取的版本、本设备的嵌入模型，以及该表的本地列。`start()` 只把当前标记不同的分片排入队列，因此切换模型或 MemOS 表结构变化仍会重新应用每个分片。重新发布会清除这些标记。发布不记录标记，因此本设备写入的分片会在下次启动时再应用一次。
- `@aeven/web-app/node-mcp` 从该组合包自身的依赖中解析服务器的 `bin` 条目，并用 `process.execPath` 启动 `@aeven/mcp-client`。两个浏览器服务器都是 `@aeven/web-app` 的精确版本依赖，版本与 `npx` 固定的相同。
- 动效与邮件模块在首次调用时用 `await import()` 导入这些库。

## 曾考虑的替代方案

- **把每个 Google 与 Microsoft 连接器合并为每个提供方一个服务器。** 已否决：每个连接器都是独立的授权，有自己的令牌与工具命名空间，合并需要一次合并授权，并会重命名模型可见的工具。连接器子进程已在 `connectorIdleMs` 后停止。
- **空闲时卸载 Whisper 工作进程。** 已否决：冷启动的工作进程在首次转写前要花数十秒编译 Metal 内核。
- **在首次使用时启动浏览器 MCP 服务器。** 已推迟：模型调用它们的工具之前，这些工具必须已在工具索引中。
- **调低 `compactAfter`。** 跳过未变化的分片后，启动开销已不需要它；它以后台 CPU 换取存储大小。

## 后果

本变更后的首次启动会把每个分片应用一次并记录其标记；之后的启动只打开发生变化的分片。标记只会让状态、模型与列都与记录一致的分片被跳过，因此不一致只多花一次应用，从不跳过变化。
