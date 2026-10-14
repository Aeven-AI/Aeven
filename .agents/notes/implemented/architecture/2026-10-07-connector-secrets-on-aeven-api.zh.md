# Agent Note：所有连接器与身份密钥都保存在 Aeven API 上

Status: implemented

[English](2026-10-07-connector-secrets-on-aeven-api.md) | 中文

## Problem

宿主并不总是 Aeven 运营的服务器。桌面应用在读者自己的机器上运行 `@aeven/web-app` bundle，该进程读取的任何内容都可以从中提取。宿主曾读取三类部署密钥：

- `identity-user-aeven` 使用 Aeven API 自身的 `JWT_SECRET` 与 `REFRESH_SECRET` 以 HS256 校验 access bearer 与 refresh cookie。API 签发的是 `{ userId }`，因此持有任一密钥的人都能为任何用户伪造 token，包括该用户在 `/v1` 上的钱包。
- `account-integrations` 使用 Google 与 GitHub 的客户端密钥兑换 OAuth 授权码并刷新授权，并使用 Discord 客户端密钥安装 Discord。
- Discord 连接器进程收到共享的机器人令牌，它控制着每位用户安装到的每个服务器中的机器人。

打包后的桌面版本不会加载 `.env`，因此这些流程只能在代码仓库检出中运行；要让它们在发布版本中运行，就必须把密钥一起发布。

## Decision

Aeven API（`servers/node`）持有上述全部密钥，宿主只能通过以已登录用户自己的 Aeven 访问令牌认证的调用触及它们（`AEVEN_TOKEN`，即 `llm-aeven` 已在出示的凭据）。

- **身份。** API 使用 `JWT_PRIVATE_KEY` 以 ES256 签发 access 与 refresh token，用 `typ` claim 区分二者，校验时固定 `algorithms: ['ES256']`，并在 `/.well-known/jwks.json` 提供公钥。`identity-user-aeven` 在加载时获取该密钥集并在本地校验，因此身份 seam 保持同步；token 若指明未知的 `kid`，会触发限速的重新获取。原先复用 `JWT_SECRET` 的 express-session cookie 现在使用独立的 `SESSION_SECRET`。
- **OAuth 连接器（Google、GitHub）。** API 的 `/connectors` 路由发起授权（state 与 PKCE verifier 保存在 `ConnectorConsent` 中），在 `<web domain>/connectors/oauth/callback` 接收提供商的重定向，用客户端密钥兑换授权码，并将授权加密保存在 `ConnectorGrant` 中。宿主在 `list()` 中轮询该授权（窗口重新获得焦点时设置会调用它），随后获取访问令牌、验证 API 访问，并写入带有已授予权限范围的行。每个步骤前宿主向 API 请求当前访问令牌；刷新令牌从不离开 API。Google 连接器使用与登录分离的 Google Cloud 项目，因此受限权限范围的验证不会影响登录。
- **Discord。** 安装授权走同一组路由；API 确认机器人已加入并返回服务器信息。连接器进程得到指向 API Discord 代理的 `DISCORD_API_BASE`，以及 `DISCORD_AUTHORIZATION: Bearer <所有者会话>`。只有当路径指向调用者的服务器，或 Discord 报告属于该服务器的频道或邀请时，代理才以机器人身份转发。只有在没有任何 Aeven 用户仍安装该机器人时，机器人才会退出该服务器。
- **Telegram。** 应用标识提供给已登录的宿主，并缓存在宿主的凭据提供方中，使已关联的账户可在启动时运行。每个 MTProto 客户端都必须出示它们，因此无法对运行在用户机器上的客户端隐藏；它们只标识应用，不授予任何账户权限。

## Alternatives considered

- **把密钥嵌入桌面版本**——任何已安装的副本都可提取。
- **每次请求都调用 API 校验 token**——身份 seam 同步解析，而公钥无需请求即可提供同样的保证。
- **在 API 上运行 Discord 工具**——会把 MCP 工具面迁入另一个代码库；代理让工具面留在 `native/discord-mcp`，只迁移凭据。
- **在 API 上运行 Telegram 会话**——API 将持有每位用户 Telegram 账户的完全访问权。

## Consequences

- 所有者在宿主上没有有效会话时运行的对话步骤，不包含 Google、GitHub 和 Discord 工具；所有者会话轮换时 Discord 进程会重启。
- 切换到 ES256 会让所有用户退出登录一次。
- Microsoft Graph 连接器共用 API 拥有的 Entra 应用；工作租户可能需要管理员批准。
- 此次变更之前写入的连接器行没有 `grant`，需要重新连接。
