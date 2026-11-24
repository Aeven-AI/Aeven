# Agent Note：Spotify、Cloudflare、AWS、Supabase、Calendly、Google Cloud、Azure DevOps、Oracle Cloud 及 Google 任务、通讯录、Meet 连接器，按类别列出

Status: implemented

[English](2026-11-24-more-connectors-grouped-by-category.md) | 中文

## 问题

用户要求接入 Spotify、Cloudflare、AWS、Supabase、Calendly、其他主要云平台，以及 Æven 无需受限范围即可访问的所有 Google 服务。提供商增至 35 个后，平铺的连接器列表已无法让读者按用途找到连接器。

## 决定

- **供应商托管的服务器。** Cloudflare（`https://mcp.cloudflare.com/mcp`）、AWS（`https://aws-mcp.us-east-1.api.aws/mcp`）、Supabase（`https://mcp.supabase.com/mcp`，在 `api.supabase.com` 授权）和 Calendly（`https://mcp.calendly.com/`，在 `calendly.com` 授权）动态注册客户端，因此各自只是 Aeven API 上的一个 `HOSTED_MCP` 条目及宿主 `hosted-mcp.ts` 中的一个端点（[托管 MCP 连接器](2026-11-24-hosted-mcp-connectors-trust-vendor-read-hints.zh.md)）。AWS 和 Calendly 只接受公开客户端；AWS、Supabase 和 Calendly 不发布撤销端点。Cloudflare、AWS 和 Supabase 不发送 scope 参数，沿用服务器的默认授权；Calendly 请求其受保护资源元数据列出的三个范围。
- **Spotify 通过部署方应用接入。** Spotify 的托管 MCP 服务器（`mcp-gateway-external-pilot.spotify.net`）经由 `accounts.spotify.com` 授权，后者不动态注册客户端，因此 API 的 `connectors.spotify` 持有 Æven 应用的客户端凭据，并请求该服务器受保护资源元数据列出的八个范围。其工具与其他托管服务器一样遵循供应商的 `readOnlyHint` 规则。
- **通过 Google 登录接入 Google Cloud。** BigQuery（`https://bigquery.googleapis.com/mcp`）和 Compute Engine（`https://compute.googleapis.com/mcp`）是 Google 自己的托管 MCP 服务器，其授权服务器为 `accounts.google.com`，因此各自是 API 上的一个 `GOOGLE_SCOPES` 条目（`bigquery`、`compute`）及宿主上的一个托管 MCP 端点。Google 每个产品提供一个 MCP 服务器，因此每个产品各为一个连接器。
- **通过 Microsoft 应用接入 Azure DevOps。** 其托管服务器位于 `mcp.dev.azure.com/<organization>`，经由 Entra 工作或学校账户授权，因此 API 的 Microsoft 应用在 `organizations` 请求 `https://mcp.dev.azure.com/.default`。该令牌并非针对 Graph，因此 API 从 ID 令牌而非 Graph 的 `/me` 读取账户。设置页面在授权前收集组织，宿主将服务器与连接行一同保存。Azure 资源没有托管 MCP 服务器，因此不提供。
- **Oracle Cloud 沿用 Salesforce 的方式。** Oracle 的托管 MCP 服务器运行在各租户内部，经由租户自己的身份域授权，且不支持动态注册，因此用户提供服务器 URL、身份域及其应用的客户端 ID 和密钥。API 的自带应用路径此前仅供 Salesforce 使用，现按提供商选择校验规则和端点；它只接受 `identity.oraclecloud.com` 主机，并请求 `openid offline_access`，宿主只接受 `oraclecloud.com` 上的 HTTPS 服务器 URL。
- **Gmail、云端硬盘和日历之外的 Google 服务。** `google-tasks`（`tasks`）、`google-contacts`（`contacts`）和 `google-meet`（`meetings.space.created`、`meetings.space.readonly`）通过同一 Workspace 桥接运行，`GWS_SERVICES` 分别设为 `tasks`、`people` 和 `meet`。这四个范围均为敏感而非受限范围，因此验证无需 CASA 评估。桥接本身没有 Meet 工具；其 `workspace_raw` 工具访问 Meet API，并以 `conferenceRecords.list` 验证授权。Chat 和 Keep 需要 Workspace 管理员，YouTube 不在桥接范围内，因此不提供。
- **类别在客户端。** `connector-categories.ts` 将每个提供商映射到一个标题——沟通、效率、开发工具、销售与营销、电商与购物、金融服务或媒体与娱乐，沿用 Claude 连接器目录的用语，自定义 MCP 服务器可以是任何服务，因此排在最后的“自定义”标题下——连接器页面在各行上方列出每个非空标题。该映射为 `Record<ConnectorProvider, …>`，新增提供商而未指定类别会导致类型检查失败。搜索会缩小每个标题下的行，并隐藏变空的标题。

## 考虑过的替代方案

- **在宿主的提供商视图中携带类别** —— 标题只关乎展示；放在客户端可避免一个没有其他使用方读取的传输字段。
- **单独的 Google 分组** —— 读者会在其他邮件连接器旁寻找 Gmail，在 OneDrive 旁寻找云端硬盘，因此 Google 提供商归入其用途对应的标题。
- **完整的 Gmail 和云端硬盘范围** —— 受限范围需要每年付费的 CASA 评估（[连接器密钥](2026-10-07-connector-secrets-on-aeven-api.zh.md)）。

## 影响

- 宿主与 Aeven API 须一同发布：宿主提供 API 不认识的提供商时，登录会失败。
- 这四个 Google 范围须添加到 `aeven-connectors` 的同意屏幕并通过验证；在此之前，授权会显示 Google 的未验证应用页面。
- Azure DevOps 需要 Aeven Microsoft 应用具备 Azure DevOps 权限，策略禁止第三方应用的组织会拒绝它。Oracle 的文档既未给出服务器主机格式也未给出所需范围，因此这两条规则须在首个真实租户上核实。
- 在 Spotify 授予扩展配额之前，Spotify 只能为该应用开发模式白名单中的账户连接，且其试点服务器可能只接受白名单内的客户端。
