# Agent Note：托管 MCP 连接器共用代理并信任供应商的只读提示

Status: implemented

[English](2026-11-24-hosted-mcp-connectors-trust-vendor-read-hints.md) | 中文

## 问题

Vercel、Atlassian、monday.com 和 Stripe 发布了托管 MCP 服务器，其授权服务器像 Notion 一样动态注册客户端（[Notion 连接器](2026-11-24-notion-hosted-mcp-through-the-broker.zh.md)）。若逐一编写专用代码，相同的注册、授权和挂载要重复四次。它们的工具集很大且会无预告地变化，因此每个供应商一份手写的读取清单会过时；清单中缺失的工具要么多余地征求批准，要么在清单宽松时未经审查就执行。另外，五个 Microsoft 连接器各需单独授权，而使用同一工作账户的用户期望只登录一次。

## 决定

- **两端各一张表。** Aeven API 的 `HOSTED_MCP` 为每个提供方列出注册、授权、令牌及撤销端点、MCP 资源、权限范围和令牌端点认证方式；Vercel 和 Stripe 只接受公开客户端，因此其注册不带密钥。Atlassian 不发布受保护资源元数据，因此其请求不指定资源。宿主的 `hosted-mcp.ts` 将每个提供方映射到其 MCP 端点。新增一个支持动态注册的供应商，只需在两端各加一项，再加上其设置文案、图标和技能。
- **由供应商的只读提示决定批准。** `@aeven/mcp-client` 将工具的 MCP `annotations.readOnlyHint: true` 复制到其 `ToolDefinition` 的 `readOnlyHint` 上，该字段绝不会到达模型。对托管 MCP 连接器，account-integrations 在 `tools/pre-execute` 中从调用代理的工具视图读取它：供应商自己的服务器标为只读的工具直接执行，其他所有工具（包括未标注的工具）都会先征求批准。Notion 保留其发布的读取清单。Claude 的连接器做出相同选择：只读连接器策略仅在服务器设置 `readOnlyHint` 时才直接执行工具。
- **Salesforce 使用自带应用。** Salesforce 的托管 MCP 服务器既不支持共享应用，也不支持动态注册，因此用户在授权时提交其组织管理员创建的外部客户端应用——“我的域”、使用者密钥及可选的使用者密码。Aeven API 只接受 Salesforce“我的域”主机，将该应用与授权一起保存以供刷新和撤销，并且由于 Salesforce 不报告令牌有效期，假定其为 15 分钟。Salesforce 工具遵循同一 `readOnlyHint` 规则。
- **Shopify 运行 Aeven 自己的服务。** Shopify 不提供托管的后台 MCP 服务器，因此 `native/shopify-mcp` 通过 Admin GraphQL API 为每个店铺运行一个 stdio 进程，提供四个工具：三个读取工具和 `graphql_mutation`。读取工具会拒绝任何定义了变更或订阅的文档，由一个针对文档顶层定义的词法分析器判断，因此其 `readOnlyHint` 成立。部署的 Shopify 应用通过代理逐店铺安装，代理校验 Shopify 在重定向及每个 webhook 上的签名，保存可过期的离线令牌，并在卸载或店铺数据删除时删除该店铺的授权。
- **Microsoft 365 与五个连接器并存。** `microsoft-365` 提供方以一次授权请求五项服务的委托权限并集，并通过同一 Graph 桥接提供它们的工具并集。Teams 和 SharePoint 仅存在于工作或学校账户中，因此它在 `organizations` 授权并拒绝消费者租户；个人账户继续使用单独的连接器。

## 考虑过的替代方案

- **为每个供应商维护精选读取清单** —— 严格，但供应商每次新增工具都需维护，而供应商的服务器本身已声明哪些工具只读。
- **对所有 MCP 服务器信任 `readOnlyHint`** —— 自定义服务器并非供应商自有，标注可能随意，因此 GitHub 和自定义连接器保留读取名称模式。
- **替换五个 Microsoft 连接器** —— 会迫使所有现有连接重新登录，并且放弃无法使用 Teams 或 SharePoint 的个人账户。

## 影响

- 若供应商把写入工具标为只读，该工具将无需批准即可执行；这种信任仅限于供应商运营的服务器。
- 每个新的供应商托管连接器都会在首次授权时向该供应商注册，每个重定向 URI 一个注册。
- Shopify 需要在 Shopify 合作伙伴后台创建 Aeven 应用，且开发店铺以外的店铺只能在 Shopify 应用商店审核通过后安装。
- Salesforce 仅在管理员已创建该应用并启用服务器的组织中可用；Aeven 无法集中完成这项设置。
- Microsoft 365 常需租户管理员批准，因为 Teams 权限要求如此。
