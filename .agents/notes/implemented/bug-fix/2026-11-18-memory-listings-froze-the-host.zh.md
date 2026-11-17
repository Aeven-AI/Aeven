# Agent Note：记忆列表查询在每个轮次前冻结 Host

Status: implemented

[English](2026-11-18-memory-listings-froze-the-host.md) | 中文

## 问题

在 Aeven Cloud 上，一个拥有 45,685 条 trace 的账户，每个轮次在发出模型请求前要等待 5–12 秒，而且召回的相关性判断会超时，尽管模型约一秒就已作答。对托管 Host 九个轮次的 CPU 分析显示，主线程在三种 trace 列表查询中连续忙碌最长达 4.6 秒，每种查询都读取每一行 trace，连同两个向量 BLOB、工具调用 JSON 和思考文本：

- 已学会流程的列表，一次针对 `Learned procedure` 的文本查询，每次记忆写入后都会重新读取；
- 检查是否已有对话标记过今天的日期，每个标记词一次文本查询，既列出又计数，各做两次全量读取；
- 画像块背后的人物事实列表。

MemOS 在 Host 进程内以同步 SQLite 运行，因此每次读取都会停住所有账户的轮次，判断的定时器也随之延迟触发。

## 决定

列表查询在 SQL 中过滤且不读取向量；其结果不变。

- `MemoryCore.listTraces` 和 `countTraces` 接受 `userTextPrefix` 与 `fromMs`，由 traces 仓库在 SQL 中应用，并且每次列表扫描都把向量 BLOB 选为 NULL。
- `@aeven/memory-memos` 通过 `userTextPrefix` 读取已学会的流程。`PROCEDURE_HEADER` 本来就要求这一前缀，因此返回的流程相同；在被分析的账户上，两种查询返回同样的 40 条 trace，耗时 46 毫秒，而不是约 2 秒。
- `MemoryListRequest.since` 按时间限定列表。日期标记检查传入最近 24 小时，这也是它唯一接受的记录范围。

## 考虑过的替代方案

- **用 SQL `LIKE` 过滤文本查询。** 对通用查询已否决：SQLite 只对 ASCII 做大小写折叠，而 JavaScript 匹配会对 Unicode 转小写，结果可能不同。
- **在记忆写入之间保留流程列表。** 读取只需数毫秒后已无必要，而且会推迟新流程的出现。

## 影响

来自记忆管理器或 `tool-memory` 的通用文本查询仍会读取每条 trace，但不含向量。搜索、排序和捕获仍在 Host 主线程上运行，在被分析的账户上每个轮次约 0.9 秒；把 MemOS 移入工作线程仍待处理。
