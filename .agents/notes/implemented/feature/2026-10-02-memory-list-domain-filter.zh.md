# Agent Note: Memory listing filters by domain at the provider

Status: implemented

[English](2026-10-02-memory-list-domain-filter.md) | 中文

## Problem

设置 → 记忆在三个标签页下展示记忆：关于你（`person`）、项目（`project`）和知识（`world` 与 `experience`）。`MemoryProvider.list` 不接受领域参数，因此页面一次获取所有领域，加载后再把记录分到各标签页。返回的 `total` 统计所有领域，所以某个标签页上的**加载更多**可能在所有未加载记录都属于其他标签页时出现，点击后用户正在看的标签页可能没有任何新增。页面还会以 offset 0 和不断增大的 `limit` 重新请求，而记忆管理器把 `limit` 截断到 `maxPageSize`，因此加载更多从未加载过新记录。

## Decision

`MemoryProvider.list` 接受可选的 `domains` 过滤（`MemoryListRequest`）。传入时，页面、其 `offset` 和 `total` 只统计这些领域中的记忆；不传时，列表行为不变。`memoryManager` Remote 从 `ManagedMemoryQuery` 透传 `domains`，每个记忆标签页请求自己的领域、按 offset 翻页，并且只在提供方报告该标签页还有未加载的记忆且上一页不为空时显示加载更多。

MemOS 无法按领域过滤：领域是 `domain:` trace 标签，未打标签的 trace 在工作区内回退为 `project`，在工作区外回退为 `experience`。因此 MemOS 提供方按 `limit` 大小分块读取该所有者匹配的 trace，用召回所用的同一个 `traceDomain` 为每条分类，保留所请求的那一页，并统计全部匹配数。一次按领域过滤的列表请求需要读取该所有者文本查询匹配的每条 trace。

## Alternatives considered

- **保留客户端过滤，并在标签页没有新内容时隐藏加载更多。** 页面不加载就无法知道未加载记录是否属于当前标签页，因此按钮仍会出现在没有更多内容的标签页上，或在标签页仍有记忆时被隐藏。
- **把领域存进 MemOS 的列并用 SQL 过滤。** MemOS 的 `listTraces` 和 `countTraces` 只按所有者、会话和文本过滤；增加列需要修改该外部依赖的数据库结构。

## Consequences

按领域过滤的 `list` 的开销随该所有者的 trace 总数增长，而不是随页大小增长。设置 → 记忆是唯一调用方，且只在用户操作时运行，因此每次打开标签页、搜索或点击加载更多时扫描一次。

## Verification

`packages/memory/memory-memos/tests/list-domains.spec.ts` 固定了按领域的分页与总数、工作区与未打标签的回退、所有者过滤、分块读取，以及不过滤时的透传。
