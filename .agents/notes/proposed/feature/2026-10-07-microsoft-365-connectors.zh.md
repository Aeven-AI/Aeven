# Agent Note：Microsoft 365 连接器，一个 Entra 应用

Status: proposed

[English](2026-10-07-microsoft-365-connectors.md) | 中文

## 问题

连接器联合类型中已经有 `microsoft365`，设置页面也已经列出 Microsoft 365 一行，但它背后没有任何实现：该提供方不拥有任何技能定义，Aeven API 上没有 Microsoft 应用，部署会把它报告为未配置。这一行承诺的五个界面——Outlook、Outlook 日历、OneDrive、SharePoint 和 Teams——也无法通过其他任何连接器到达，而它们对应的 Google 连接器（Gmail、云端硬盘、日历）已经发布。

Google 连接器就是要照搬的形态：一个可维护的 MCP 桥接按连接器行挂载，委托作用域由 API 拥有，保存该行之前先做一次默认验证调用，每个提供方一个技能包。Microsoft 的对应物与 Google 的不同：邮箱无法按[邮件连接器](2026-10-06-email-account-connectors.zh.md)的方式添加，因为 Exchange Online 已停用 IMAP 与 POP 的基本身份验证，SMTP AUTH 的基本身份验证也在同一条路径上，因此保存的密码不是通往 Microsoft 邮箱的持久凭据。

桥接是本仓库唯一尚不存在的那一部分。[`@softeria/ms-365-mcp-server`](https://github.com/Softeria/ms-365-mcp-server)（MIT、npm、基于 MSAL，覆盖邮件、日历、文件、Excel、OneNote、待办、Teams、SharePoint 与会议的数百个 Graph 工具）可以通过 `MS365_MCP_OAUTH_TOKEN` 接受预先取得的访问令牌，并通过 preset、`--enabled-tools`、`--org-mode`、`--allowed-scopes` 与 `--read-only` 收窄自己的工具面，还能用 `--list-permissions` 报出某个工具面所需的确切 Graph 权限。这与 Google 连接器和 Workspace 桥接之间的关系相同：桥接拥有 Graph 访问与工具词汇，Aeven 拥有授权、令牌、挂载、审批与指令。

## 方案

### 一个应用上的五个提供方

`microsoft365` 被五个 `ConnectorProvider` 成员取代——`outlook`、`outlook-calendar`、`onedrive`、`sharepoint`、`teams`——各有一行、一套作用域、一个桥接工具面、一个技能定义、一个图标和一个设置条目，就像今天的 `gmail`、`google-drive` 与 `google-calendar` 各自独立。由部署拥有的一个多租户 Entra 应用把客户端密钥保存在 Aeven API 上，授权按提供方进行，因此添加 Outlook 只授予邮件权限。

| 提供方 | 界面 | 授权机构 | 桥接工具面 |
| --- | --- | --- | --- |
| `outlook` | 邮箱读取、搜索、发送、草稿、文件夹 | `common` | 个人模式，mail preset |
| `outlook-calendar` | 日历、事件、邀请、空闲/忙碌 | `common` | 个人模式，calendar preset |
| `onedrive` | 已登录账户自己的驱动器 | `common` | 个人模式，files preset |
| `sharepoint` | 站点文档库、项目与列表 | `organizations` | `--org-mode`，SharePoint 与驱动器工具过滤 |
| `teams` | 团队、频道、聊天、消息 | `organizations` | `--org-mode`，Teams preset |

每个提供方的作用域列表由 API 拥有，与 Google 的完全一样，并且它取自该工具面对应的桥接 `--list-permissions` 输出，而不是手抄的清单。前三个使用 `common` 授权机构，因为个人 Microsoft 账户可以授权邮件、日历与驱动器权限；SharePoint 与 Teams 仅限工作账户。

### 宿主的桥接描述模块

宿主在 `google.ts` 旁新增 `microsoft.ts`，承担相同的三项职责，并接在同一批调用点上：

- 一张 `microsoftConnectors` 表：提供方 → 桥接工具面（模式、preset 或工具过滤、该工具面不得写入时使用只读）、默认验证工具及其参数，以及该提供方的委托作用域；
- `microsoftConnection(provider, token, directory, timeoutMs)`：某一行的私有 stdio 配置——从已安装包解析出的桥接入口，`cwd` 指向该账户自己的目录，环境里带上代理刚签发的访问令牌的 `MS365_MCP_OAUTH_TOKEN`、该行账户的 `MS365_MCP_EXPECTED_USERNAME`，以及位于该目录内的桥接令牌缓存与已选账户路径；
- `verifyMicrosoft(provider, config, timeoutMs)`：连接、列出工具，并在保存该行之前为该工具面调用一次读取工具，与 `verifyGoogle` 的做法相同。

除短期令牌之外没有任何密钥到达子进程，子进程也不做刷新：令牌在一次对话步骤内有效，宿主为下一步再次向 API 索取，与它对 Google 的做法完全一致。

### 授权、刷新，以及 API 必须点名的两种失败状态

- `services/connectors/ConnectorProviders.js` 新增五个 Microsoft 条目：按租户分段的授权与令牌 URL、`kind: "oauth"`、带 `prompt=select_account` 的 `authorizationParams`，以及每个提供方的作用域列表。
- `config.js` 与 `.env.example` 新增 `connectors.microsoft.clientId` 与 `clientSecret`，来自 `MICROSOFT_CONNECTOR_CLIENT_ID` 与 `MICROSOFT_CONNECTOR_CLIENT_SECRET`。
- `db/models/ConnectorGrant.js` 新增 `tenantId`，因为 Entra 的刷新按租户进行：个人账户的刷新必须走 `consumers`，工作账户的走它自己的租户 id——用授权时所用的相同机构去刷新个人授权会在第一次刷新时失败，大约一小时后。模型注释不再只提 Google 与 GitHub。
- `services/connectors/ConnectorService.js` 记录提供方返回的租户与账户，通过记录的机构刷新，保留 `invalid_grant` → `reauthorize`，并为携带 `AADSTS65001` 或 `AADSTS90094` 的 `access_denied` 回调新增独立的 `admin-consent-required` 阶段，使设置页面可以说清需要管理员批准，而不是报一个笼统的失败。Entra 不提供撤销端点，因此 `revoke()` 保持空操作，移除该行即删除该授权。
- `services/connectors/callbackPage.js` 与连接器测试为该阶段补充两种语言文案。

### 行、审批与技能

一条 Microsoft 行记录 Graph 报告的账户与租户 id，从不记录令牌。该行通过已有的 MCP 路径挂载，因此不需要新的执行器规则：工具以 `mcp__account_<connector-id-prefix>__<tool>` 出现，目录跟随账户自己启用的连接，已停用、已移除或属于他人的行照旧被拒绝。

审批清单按名称补充 Microsoft 的写入操作——发送与回复、创建、更新或删除事件、上传、移动、重命名、复制或删除文件、创建文件夹、共享、发布或回复频道消息、创建聊天或频道——读取仍然直接执行。Teams 管理界面、租户级目录读取与邮箱规则不属于任何对外提供的工具面。

每个提供方在 preset 下发布一个技能包（`outlook`、`outlook-calendar`、`onedrive`、`sharepoint`、`teams`），说明如何寻址该账户、该工具面做不到什么，以及哪些调用会征求审批，形式与现有的 Gmail 与日历技能一致。

### 工作清单

每一步都可独立评审，且每一步都是 API 先发布。

1. **试跑桥接。** 安装 `@softeria/ms-365-mcp-server`，用手工取得的令牌设置 `MS365_MCP_OAUTH_TOKEN`，在工作租户与个人账户上运行，抓取每个工具面的 `--list-permissions`，并记录每个提供方实际提供的工具名。这一步在任何接线之前就固定了作用域清单与验证调用，也是唯一可能推翻该选择的步骤。
2. **API：Microsoft 提供方条目。** `ConnectorProviders.js`、`config.js`、`.env.example`、授权的 `tenantId`、刷新机构、`admin-consent-required` 阶段、回调页面，以及 start、callback、refresh 与两种失败状态的单元测试。
3. **宿主：描述模块与挂载。** `microsoft.ts`，`types.ts` 中的五个提供方成员、zod 枚举、`brokeredProviders`、`connectorSkills`、`configured` 计算，以及挂载与验证调用点，并与 Google 的测试并列编写。
4. **设置页面。** 五个带品牌图标的行、英文与中文文案、每个提供方的登录操作、带部署管理员授权链接的"需要管理员批准"状态，以及被撤销授权的重新连接状态。
5. **技能。** 五个技能包，各自对照试跑记录的工具面评审。
6. **组合与文档。** 在挂载账户集成的包中加入桥接依赖、提供这些行的已发布 profile、`THIRD_PARTY_NOTICES.md`、账户集成与设置的两种语言 README，以及重新生成的配置目录。
7. **Teams 与 SharePoint 最后做**，使用同一个描述模块：它们需要 `--org-mode`、`organizations` 授权机构，以及多数租户保留给管理员的权限，因此在三个同时支持工作与个人账户的提供方端到端跑通之后再发布。

## 分阶段

1. 针对 `outlook`、`outlook-calendar` 与 `onedrive` 完成第 1–6 步：这三个支持个人账户的提供方一次性验证 API、挂载、审批、技能与设置状态。
2. 第 7 步针对 `sharepoint` 与 `teams`：除模式、授权机构与第 2 步已建好的管理员批准状态之外，不引入任何新机制。
3. 推迟，各自需要独立的说明：在租户持有 Copilot 许可证且管理员启用的前提下，把 [Work IQ MCP 服务器](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview)作为可选提供方接入；通过 API 把 Graph 变更通知送到会话，这才可能让这些连接器从按需读取变为主动推送；把 Google 日历迁移到共享的日历工具；以及当该依赖的工具面、审批粒度或维护状况不再合适时，自建一个 Graph 桥接。

## 考虑过的替代方案

- **自建 Graph 桥接或在进程内建立能力接缝** —— 自有的薄 Graph 客户端，加上邮件、日历、驱动器与 Teams 接缝，或在进程内实现，或作为 vendored 的 `native/graph-mcp`；它换来我们掌控的工具词汇，代价是每个接缝一个包、四套新工具集及其测试与文档。作为第一步已否决，因为可维护的桥接已经提供这些界面，而 Google 连接器已经示范了围绕一个桥接的挂载、验证与审批模式。
- **一个带五个界面的 `microsoft365` 连接器** —— 一次授权覆盖全部、作用域全有或全无、一行承载多个账户，并为用户从未启用的服务组装工具目录；已否决，改用按服务划分的提供方，与 Google 保持一致。
- **Microsoft 自有的 MCP 服务器** —— 只读的 Entra 目录 [MCP Server for Enterprise](https://learn.microsoft.com/en-us/graph/mcp-server/overview)回答的是身份问题而不是这五个界面，而 Work IQ 服务器处于预览阶段、需要每位用户拥有 Microsoft 365 Copilot 许可证、并需要在每个租户由管理员启用；已否决作为默认方案，保留为延后的可选提供方。
- **让 Outlook 邮件走邮件连接器的 IMAP 或 SMTP 路径** —— 这正是 Microsoft 已为 IMAP 与 POP 停用、并正在为 SMTP AUTH 停用的传输方式；已否决，原先为 Outlook 提出 XOAUTH2 的那份说明在这一点上被取代。
- **让桥接以 `--http` 模式自带 OAuth** —— 那会把 OAuth 应用、授权页面与刷新令牌交给桥接，而这正是连接器密钥规则要防止的安排；已否决，改用由 API 按步骤签发令牌的 BYOT 方式。

## 验收标准

- 五个行都能在工作租户中从设置页面添加，邮件、日历与驱动器三行也能用个人 Microsoft 账户添加；每一行都能独立关闭、重新添加与移除。
- 授权后每个服务立刻有一次成功的读取，且验证调用就是试跑为该工具面记录的那一个：列出邮件、列出日历、列出驱动器项目、读取站点文档库、读取聊天。
- 发送邮件、创建事件、上传文件与发布频道消息各自先征求审批然后成功；读取从不征求。
- 没有任何 Microsoft 连接器的账户在其步骤工具目录中看不到这些工具，已停用、已移除或属于他人的连接器一律被拒绝。
- 客户端密钥、刷新令牌与访问令牌都不出现在连接器行、Remote 响应、工具结果、浏览器响应或日志中；子进程环境只携带一个短期令牌，不含任何密钥。
- 因租户关闭用户同意、或因某个权限需要管理员而被拒绝的授权，会带着链接报告为需要管理员批准；被撤销或过期的授权会把其行显示为需要重新添加。
- 验证：`pnpm run typecheck`、绿色的 `pnpm run build`、API 的连接器单元测试、宿主的连接器测试，以及在工作租户中逐服务的实机验证，外加上面三个支持个人账户的提供方的个人账户验证。

## 风险

- 桥接是针对快速变化的 Microsoft API 的第三方依赖，其工具名、preset 与权限映射都可能在我们脚下变化；描述模块与技能是按试跑记录的工具面写的，升级版本时需要重跑该步骤。
- 门槛是授权，而不是代码。租户策略、未验证的发布者，或尚未批准的管理员，都可能让每一行都无法添加，而这些在编译中完全不可见。
- 桥接天然宽泛：工具面过滤得不够紧，无用的工具就会进入目录，而真正约束一次调用的是 Graph 权限。过滤、适用处的 `--read-only`，以及 API 的作用域清单，是守住这一点的三个位置。
- 个人 Microsoft 账户无法到达 SharePoint 或 Teams，因此这两个提供方仅限工作账户，它们在个人账户中不出现是预期行为。
- Teams 是这里最敏感的界面：频道读取需要管理员，而一个能向频道发帖的工具就等于在同事面前以用户身份行动，因此对外提供的工具面保持窄面，写入每次征求同意。
- 每一步都要两个仓库同步推进，且 API 在先；宿主必须退化为"未配置"，而不是登录失败。
