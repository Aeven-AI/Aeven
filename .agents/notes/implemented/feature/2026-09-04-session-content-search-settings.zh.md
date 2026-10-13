# Agent Note: Session 内容搜索默认延迟启用且可由用户配置

Status: implemented

[English](2026-09-04-session-content-search-settings.md) | 中文

## Problem

已发布 profile 以 `openAt: never` 挂载 SQLite session-query 提供方。侧边栏仍提供内容搜索，但每次查询都会回退到名称匹配，并用一条文案把有意的部署设置描述为暂时不可用。尽管 Web 客户端已有持久化插件设置界面，用户仍只能通过编辑 profile patch 来启用该功能。

## Decision

基于 base 的已发布 profile 以 `openAt: first-search` 配置 `session-query-sqlite`。内容搜索默认可用，同时启动期间不会导入 `node:sqlite` 或打开派生索引。

SQLite 提供方注册仅包含 `openAt` 的 `session-query-sqlite` 设置分节。插件设置页面把该字段显示为暂存式**搜索会话内容**开关：打开时存储 `first-search`，关闭时存储 `never`，重置时恢复组装值。数据库位置、journal 策略、结果界限与协调调优仍属于部署配置。

Session Controller 把 `SESSION_QUERY_SEARCH_DISABLED` 映射为 `session/search-disabled`。Workspace 浏览器使用该代码区分“已在设置中关闭”与索引或传输失败，同时在两种情况下都保留即时标题与 Workspace 名称匹配。

## Alternatives considered

**启动时打开 SQLite。** 这会降低首次查询的延迟，但即使没有内容搜索，每个进程仍会承担导入与打开索引的成本。延迟打开既保证默认可用，也不会增加启动工作。

**在 UI 中公开 SQLite 提供方的全部字段。** 这会让浏览器用户改变文件系统归属、数据库生命周期与资源界限。这些值仍由部署拥有；只有可用性属于用户偏好。

**保留通用回退文案。** 单一警告更简单，但无法告诉用户可在设置中解决关闭状态。稳定的 Remote 错误代码无需解析 Host 诊断即可携带该区别。

## Consequences

进程中的首次内容查询会承担 SQLite 初始化，并触发 Node 的实验性 SQLite 警告。关闭搜索会拒绝新的全文调用，但不会关闭已经打开的索引；插件 teardown 仍拥有该 handle。内容搜索关闭时，精确会话读取、过滤、追踪、标题匹配与 Workspace 名称匹配仍可用。
