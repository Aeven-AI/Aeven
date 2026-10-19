# Agent Note: Memory listing filters by domain at the provider

Status: implemented

[English](2026-10-02-memory-list-domain-filter.md) | 中文

## Problem

设置 → 记忆在三个标签页下展示记忆：关于你（`person`）、项目（`project`）和知识（`world` 与 `experience`）。`MemoryProvider.list` 不接受领域参数，因此页面一次获取所有领域，加载后再把记录分到各标签页。返回的 `total` 统计所有领域，所以某个标签页上的**加载更多**可能在所有未加载记录都属于其他标签页时出现，点击后用户正在看的标签页可能没有任何新增。页面还会以 offset 0 和不断增大的 `limit` 重新请求，而记忆管理器把 `limit` 截断到 `maxPageSize`，因此加载更多从未加载过新记录。

## Decision

`MemoryProvider.list` 接受可选的 `domains` 过滤（`MemoryListRequest`）。传入时，页面、其 `offset` 和 `total` 只统计这些领域中的记忆；不传时，列表行为不变。`memoryManager` Remote 从 `ManagedMemoryQuery` 透传 `domains`，每个记忆标签页请求自己的领域、按 offset 翻页，并且只在提供方报告该标签页还有未加载的记忆且上一页不为空时显示加载更多。

MemOS 的 `listTraces` 与 `countTraces` 在 SQLite 中应用领域与项目工作区过滤。第一个有效的 `domain:` 标签决定领域；未打标签的 trace 在工作区内为 `project`，在工作区外为 `experience`，与 `traceDomain` 一致。没有文本搜索的分页只读取所请求的行；计数使用相同条件且不加载轨迹内容。文本搜索在数据库过滤领域和工作区后，保留 MemOS 的子串匹配。

## Alternatives considered

- **保留客户端过滤，并在标签页没有新内容时隐藏加载更多。** 页面不加载就无法知道未加载记录是否属于当前标签页，因此按钮仍会出现在没有更多内容的标签页上，或在标签页仍有记忆时被隐藏。
- **把领域存进 MemOS 的列并用 SQL 过滤。** SQLite 的 JSON 函数可过滤现有标签，无需新增列或迁移数据库结构。

## Consequences

打开标签页或加载下一页执行一次分页读取与一次计数。计数仍会检查匹配行的领域标签，但不解码其完整文本、工具调用或嵌入。领域条件在分页前保留所有者隔离与项目可见性。

## Verification

`packages/memory/memory-memos/tests/list-domains.spec.ts` 固定了按领域的分页与总数、工作区与未打标签的回退、所有者过滤、超过仓库分页上限时的单页读取、领域标签优先级、空领域过滤、项目可见性，以及不过滤时的透传。
