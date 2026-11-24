# Agent Note：Notion 通过连接器代理挂载其托管 MCP 服务器

Status: implemented

[English](2026-11-24-notion-hosted-mcp-through-the-broker.md) | 中文

## 问题

Notion 是第一个其提供商不发布可注册普通 OAuth 应用的连接器。其托管 MCP 服务器 `https://mcp.notion.com/mcp` 只接受自身授权服务器签发的令牌；该授权服务器动态注册客户端（RFC 7591），并要求在授权及令牌请求中携带 MCP 资源（RFC 8707）。Notion 的经典公开集成则对接 REST API 及开源的本地 MCP 服务器，其工具对应原始 API 调用，而非托管服务器的 Markdown 页面工具。

## 决定

连接器使用托管服务器，Aeven API 仍是其凭据的唯一持有者，与 Google、Microsoft 和 GitHub 相同（[连接器密钥](2026-10-07-connector-secrets-on-aeven-api.zh.md)）。

- **注册。** 首次 Notion 授权时，API 以机密客户端（`client_secret_post`）身份在 Notion 的注册端点注册自身，以其连接器回调作为唯一重定向 URI，并将结果保存在 `connector_clients` 中，密钥加密存储。该行以提供商和重定向 URI 为键，因此开发与生产环境分别注册，回调变更后会重新注册。并发的首次授权共享同一注册；Notion 之后以 `invalid_client` 拒绝的注册会被删除，下次授权重新注册，已有授权则提示重新连接。
- **授权。** 授权、授权码兑换、刷新及撤销都经由现有代理路由，使用所存注册的凭据及 `resource=https://mcp.notion.com/mcp`。宿主将 Notion 视为又一个代理提供商：通过 `broker.token()` 获取短期访问令牌，并以 Streamable HTTP 挂载托管服务器。
- **批准。** Notion 的工具名称（`notion-search`、`notion-create-pages`）不符合共享的读取名称模式，因此 `notion.ts` 按 Notion 发布的参考列出读取工具。其他所有工具（包括 Notion 日后新增的工具）都会先征求批准。

## 考虑过的替代方案

- **经典 Notion 公开集成加本地服务器** —— 需要 Notion 开发者应用及其密钥，每个对话运行一个 stdio 进程，且提供 API 形态的工具，而非 Notion 维护的托管工具。
- **客户端 ID 元数据文档** —— Notion 支持以 URL 作为 `client_id`，可省去所存注册，但该文档必须从公开源提供，开发环境的 API 若不依赖生产环境便无法登录。
- **在宿主上注册** —— 宿主将持有客户端密钥及刷新令牌，而连接器密钥决定将其保留在 API 上。
- **在 API 上复用 MCP SDK 的 `auth()` 辅助函数** —— 会重复代理现有的 state、PKCE、兑换及刷新处理；缺少的只有注册与资源参数。

## 影响

- 部署无需配置任何 Notion 凭据；API 配置中的 `connectors.notion` 仅用于在 Notion 授权页面上显示客户端名称。
- Notion 授权只能访问用户在 Notion 授权页面上共享的页面。
- Notion 连接行以提供商命名，与 GitHub 相同；不记录工作区名称。
