# Agent Note：导入的轮次会刷新 Session 的列表行

Status: implemented

[English](2026-11-11-imported-turns-refresh-list-rows.md) | 中文

## 问题

2026-11-11，一个在 chat.aeven.io 上开始、由用户桌面端回答的对话在重新加载后从 Aeven Web 侧栏中消失。打开它时，该行显示为 New Session，并在 778 个事件的对话下方绘制了 New Session 的主视觉。Host 的 `session/list` 将该 Session 返回为 `blank: true`，投影位于 `asOfSeq: 2`，而它的存储日志已到 seq 777。

Aeven Web 创建新的网页聊天时，会在创建时写入它的投影缓存行（只有初始化事件，因此 `blank: true`），然后把输入转发给桌面端。之后每个轮次都以导入事件的形式到达 Aeven Web，在没有活动 Session 的情况下追加到存储日志，因此没有运行任何后写检查点。`summaryForStored` 通过 `hydratePrepared` 折叠导入的日志，而它不写缓存行，所以只有导入时已连接的客户端看到了更正后的行；之后的每次 `list()` 都提供创建时的行。`list()` 中的标题重新折叠会跳过空白行，因此没有任何路径修复它。在桌面端开始的聊天不受影响，因为 Aeven Web 没有它的缓存行，标题重新折叠会从完整日志构建一行。

## 决策

`summaryForStored` 通过 `sessionProjectionCache.coldSnapshot` 折叠冷 Session 的观察日志，它会把刷新后的行写回，因此每次导入后缓存都是最新的。`list()` 还会在现有的 20 行重新折叠预算内，重新折叠账号目录条目领先于缓存行的空白行，并从重新折叠后的列表元数据中取得 `blank` 和 `updatedAt`。重新折叠后仍为空白的行保持隐藏，因此真正空的聊天不会出现在侧栏中。

## 考虑过的替代方案

根据已打开对话的事件推导主视觉和侧栏可见性，只会在一个客户端中掩盖症状，而 Host 仍然提供错误的列表。从 session-sync 镜像写入缓存行，会把投影知识放进只负责追加事件的同步层。

## 影响

在此更改之前变旧的行，会在第一次看到它们的列表请求中修复。导入的 Session 的缓存行现在也会在标题、轮次数和活动时间上跟随日志，而不仅是空白状态。如果空白行的目录领先于尚未导入的日志，它会在每次列表时重新折叠，直到导入完成；该日志只包含初始化事件，因此重新折叠的开销很小。

## 验证

`@aeven/api-session-controller` 的类型检查和构建通过。部署前在 chat.aeven.io 上检查了全部 1,211 个列表行：3 行为空白，只有受影响 Session 的日志（seq 777）领先于其缓存行（seq 2）；另外两个日志都止于其缓存行。
