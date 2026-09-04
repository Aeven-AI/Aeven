# Agent Note: 浏览器 Session 路由

Status: implemented

[English](2026-09-03-browser-session-routes.md) | 中文

## 问题

Web 客户端过去只在 Session Controller 内部选择 Session。地址栏始终停留在 `/`，因此无法复制当前 Session 的直接链接，重新加载不会携带显式导航意图，浏览器的后退与前进也不会遍历 Session 选择记录。

## 决策

Workspace UI 导航服务把选中的 Session 投影到 `/c/:id`，其中 id 是 Host 自身的 id 去掉它铸造的 `session-` 前缀：在客户端唯一路由的这条路径上，集合段与 id 前缀都在说“session”。前缀在写出时去掉、读入时补回，因此客户端其余部分处理的每个 id 都未改变；仍带该前缀的地址按原样读取，而不会被重复添加前缀。初始 baseline 协调会替换启动历史记录，后续 Session 变化会压入新记录，`popstate` 则重新打开恢复路径所指的 Session。Session 与 Workspace baseline 就绪后，有效路由优先于持久化的当前选择。若 id 未知，则先移除该 id，再由现有最近 Workspace 回退选择 Session。

frontend-static 回退会为 `/c/` 下缺失且无扩展名的路径提供经过认证的应用 index。静态文件保持直接文件语义，已有目录继续返回 404，显式前缀之外的未知路径也继续返回 404。这样 Session 重新加载会留在 SPA 内，同时不会把每个拼写错误或缺失资产都变成 index 响应。

## 考虑过的替代方案

**让导航完全保留在内存中。** 这能维持最小的 Client 界面，但浏览器历史、重新加载与复制链接都得不到 Session 身份。

**把 Session 身份放入查询参数或 hash。** 两者都不需要更改服务器，但会让主要应用导航看起来像附带的页面状态。pathname 能为 Session 提供稳定的顶层 Web 地址。

**为所有无扩展名的未命中请求提供 index。** 宽泛回退会让未来客户端路由更容易添加，但也会掩盖未知路径错误。因此服务器只接纳客户端当前拥有的路由前缀。

## 后果

Session 导航现在是浏览器历史与 Session Controller 之间的双向投影。每个新的顶层 SPA 路由都需要 Client 解析逻辑，以及带真实组合覆盖的显式 frontend-static 前缀。Session id 在 pathname 中采用百分号编码，而与 Session 选择无关的 query 与 fragment 字段会在 Client 转换期间保留。
