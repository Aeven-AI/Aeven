# Agent Note：Slack 是 Slack MCP 服务器之上的一个插件，每个工作区一行

Status: implemented

[English](2026-10-07-slack-connector.md) | 中文

## 问题

设置页面曾在连接器目录中列出 Slack，并把读者送到自定义 MCP 表单去配一个由提供方签发的令牌，因为 `ConnectorProvider` 中没有 `slack` 成员、没有技能随附，产品中也没有任何东西知道什么是 Slack 工作区。Slack 有用的操作不是读取某一个频道，而是在某处找到一个工作区里的那个决定、那个文件或那个人，而这项操作需要用户令牌：[`search.messages`](https://docs.slack.dev/reference/methods/search.messages) 只在 **User token** 下列出 `search:read`，接替它的[实时搜索 API](https://docs.slack.dev/apis/web-api/real-time-search-api) 在每次机器人令牌调用上都需要 `action_token`，它只存在于 Slack 交互内部。因此，任何以机器人令牌为凭据的设计都做不到连接 Slack 唯一值得做的事。

连接器的其余部分不是新工作。这套界面由 Slack 自己提供：[Slack MCP 服务器](https://docs.slack.dev/ai/slack-mcp-server/)在 `https://mcp.slack.com/mcp` 上以 Streamable HTTP 承载 JSON-RPC 2.0，并以普通的 Slack 用户令牌认证。每个已经集成 Slack 的 harness 都这么做，形态也是公开的：OpenAI 的插件目录把 Slack 呈现为一份 [`.mcp.json`](https://github.com/openai/plugins/blob/main/plugins/slack/.mcp.json)——端点、`type: "http"` 与公开的 `oauth.client_id`。本仓库的图标已经在沿用该目录的连接器资产。Claude Code、Codex、Cursor 与 Pi 都用公开客户端、不带密钥连接同一个端点；Slack 的 [PKCE 文档](https://docs.slack.dev/authentication/using-pkce/)说明，桌面重定向用 `code_verifier` 兑换授权码，**不需要** `client_secret`，刷新也不需要密钥。

## 决策

`slack` 是一个 `ConnectorProvider`，而该连接器就是一份描述符：端点 `https://mcp.slack.com/mcp`、部署的 Slack 应用客户端 id、每个工作区一行、一个图标、两种语言的描述，以及一个技能包。Aeven API 没有新增任何东西，没有代理介入调用，也不存在机器人。部署需要配置 `slackClientId`——公开，且是它持有的唯一 Slack 值——以及 `slackCallbackPort`、`slackDirectMessages`、`maxSlackWorkspaces` 与 `slackVerifyIntervalMs`。

Aeven 注册自己的 Slack 应用，而不是借用另一个 harness 的客户端 id。Slack 把速率限制、日志与工作区管理员批准都绑定在客户端背后的应用上，因此另一个产品的 id 会让这个连接器恰好在工作区管理员决定是否放行的地方与那个产品无法区分。那些参考实现是该形态的证据，而不是可以复用的凭据。

登录在本宿主上运行，位于 `packages/host/account-integrations/src/slack-login.ts`。`authorize('slack')` 启动它：生成 S256 verifier 与 challenge、绑定 `127.0.0.1:<slackCallbackPort>`、以工作区作用域构造 `https://slack.com/oauth/v2_user/authorize`、返回该 URL 供设置页面打开，并在 Slack 连同登录自造的 state 重定向回回调地址时结束。兑换以 `code_verifier` 且不带客户端密钥 POST 到 `https://slack.com/api/oauth.v2.user.access`，Slack 自身的 `auth.test` 则给出该行记录的团队与账户。每种失败都带固定原因——`port`、`state`、`denied`、`approval`、`exchange`、`response`、`unauthorized`、`timeout`、`cancelled`——只有 `unauthorized` 与已耗尽的授权算作授权本身已失效，这正是把某一行变成需要读者重新连接的那一行的依据。

回调端口就是已注册的重定向 `http://127.0.0.1:<slackCallbackPort>/callback`，Slack 对它做精确匹配，因此端口被占用会以这一事实失败，而不会漂移到应用没有注册的端口。令牌包——访问令牌、刷新令牌、过期时间、所授予的作用域——是该连接器在账户凭据提供方中的 `grant` 记录，宿主在使用前刷新它，而它绝不会出现在行、Remote 响应、工具 schema、模型请求或日志中。断开连接会在 Slack 侧撤销该令牌。

连接单位是一个工作区，正如 [Discord 的单位是一个服务器](../../implemented/architecture/2026-10-07-discord-connector-guilds.zh.md)：一行连接器、一个从 Aeven 账户与 Slack team id 派生的连接器 id（因此重新连接后工具名不变）、一个 `mcp__account_<id>__` 命名空间，以及一个启用、禁用与移除开关。`maxSlackWorkspaces` 限制一个账户可持有的行数。该行以存储的用户令牌作为 bearer，通过现有的远端 Streamable HTTP 路径挂载——与 GitHub 行所用的同一条路径——并且只有在 Slack 的 MCP 服务器接受该令牌之后才保存该工作区，因此管理员尚未批准该应用的工作区会被拒绝，而不会被保存成坏行。

Slack 拥有所提供工具的名称，因此 `isSlackReadTool` 按名称自身的动词分类，对任何无法识别的名称返回 false：搜索、读取、列出、获取、抓取、下载、查询、查找与解析直接运行，除非名称中另有本身就是写入的词——这正是让 `slack_get_file_upload_url`（上传的前一半）与其后一半一起留在批准门控之后的原因。其他任何名称都征求批准并自报其名，文案则说明消息将以读者身份而非带标签的机器人身份出现。

Slack 的服务器自行渲染这些工具返回的内容，因此消息文本按 Slack 的渲染到达，没有 `native/discord-mcp` 施加于 Discord 自身记录的 nonce 围栏；该指令改由 preset 中的 `slack` 技能承载。该技能还说明在连接了多个工作区时如何选择连接、搜索以读者自身的权限与按用户限速运行，以及所发布的消息以读者身份出现。设置页面新增 Slack 行，带来自 Simple Icons 的品牌图标、英文与中文描述、登录操作、令牌被撤销或刷新过期后的重新连接状态，以及管理员批准状态。

## 考虑过的替代方案

**完全不写代码：让目录条目继续指向自定义 MCP 表单。** 本决策的一半——端点——正是目录要求读者手工拼起来的那份插件，因此这个替代方案只是一行文案，而不是一个实现。已否决，因为它让每位读者都变成 Slack 应用开发者，而且产品随后无法知道某一行属于哪个工作区、无法显示 Slack 是否仍然接受它，也无法在移除时撤销它。

**`native/` 下自建的机器人连接器，如 Discord 那样。** 一个 Aeven 自有的 Slack 应用、一个机器人令牌、每个工作区一行、一套精选工具面，而且与 Discord 不同——不需要代理，因为 Slack 的服务器自己执行权限。已否决，因为它无法搜索：`search.messages` 仅限用户令牌，而实时搜索 API 需要来自 Slack 交互的 `action_token`，因此机器人界面只能读取它被邀请的频道，按需什么也找不到。保留为延后路线，以备将来需要与读者分离的发布身份。

**像 Google、Microsoft、GitHub 与 Discord 那样，用客户端密钥把登录代理到 Aeven API。** 这是本提案最早的版本，当部署持有一个不得抵达非自有机器的密钥时，它是对的形态。这里已否决，因为并不存在这样的密钥：Slack 的 PKCE 客户端是公开的，被保护的令牌属于在自己机器上完成授权的读者，而宿主早就为它的自定义 MCP 连接存储读者自己的 bearer。代理会新增 API 路由、环境变量与一个已注册的服务器回调，用这些代价换回的正是它花掉的东西；它唯一真正的优势——刷新令牌不会在闲置 30 天后过期——不足以让首个版本背上一个子系统。

**把第三方 Slack MCP 服务器作为依赖保留。** [`korotovsky/slack-mcp-server`](https://github.com/korotovsky/slack-mcp-server) 及其同类提供更宽的界面，其中仍在维护的那些用读者自己 Slack 客户端的浏览器会话 cookie（`xoxc`/`xoxd`）认证。已否决：那条路径把某个人的会话当作客户端，这是 Slack 条款不允许的，并且让部署手上多了一个长期有效的会话凭据。

**用机器人令牌加实时搜索 API，而不是用户令牌。** 已否决：每次以机器人令牌调用 `assistant.search.context` 都要求发送其在消息事件中收到的 `action_token`，而不在回答 Slack 交互的 harness 拿不出它。

**动态客户端注册，即通常的 MCP OAuth 路径。** Slack 不支持动态客户端注册，并要求 MCP 客户端背后是一个带固定 app id 的已注册应用。已否决：Aeven 应用就是该客户端，其身份属于部署配置，而不是发现结果。

**在 API 上运行 Slack 工具。** Discord 需要 API 侧代理，因为机器人令牌不得离开 API，而 Discord 无法以某一个用户的身份行事。Slack 的服务器已经收到按用户签发的令牌，并执行该用户的权限，因此代理没有什么可执行的。已否决：它会为了零安全收益而把工具面搬进另一个代码库。

**Slack 只保留一行，每个工具都带工作区参数。** 行更少，所有工作区共用一个命名空间。已否决，理由与 Discord 的同类方案相同：每个工作区共用一个启用开关、模型可以带着它无法验证的 id 跨越边界，以及在结构上没有回答“绝不读错工作区”。

## 后果

该连接器换来了工作区形态的行、按权限行事的界面，以及无需保护的部署密钥：部署只需要一个启用 PKCE 并注册了回调的 Slack 应用，别无其他。作为交换，它放弃了三件事。启用 PKCE 是应用上的单向设置，因此不经 Slack 支持，该客户端无法回到机密客户端。Slack 的 PKCE 刷新令牌在 30 天未使用后过期，因此一年只用几次的工作区需要重新连接。重定向是在所配置端口上的精确匹配，容忍度比一段端口扫描更窄：端口被占用就是一次点名该端口的连接失败。

以读者身份行事是刻意的行为，也是最锋利的后果：通过该连接器发出的消息来自这个人，而不是来自挂着 Aeven 名字的机器人，搜索也恰好返回这个人有权看到的内容。私信搜索与历史是这套界面中最敏感的部分，因此默认请求与应用的已注册作用域都不包含它们；`slackDirectMessages` 在授权时加入它们，而在此开关打开之前已连接的工作区必须重新连接才能获得。

Slack 门控的是服务器而不是代码：只有已在 Marketplace 发布的应用或内部应用可以使用 MCP，且工作区管理员可以拒绝该集成，因此某个工作区的首次连接可能需要管理员。来自授权页面或兑换环节的拒绝会报告为管理员批准状态；Slack 不再接受的令牌会报告为需要重新连接的行。闲置超过刷新窗口的工作区也以同样方式被发现，即由最多每个 `slackVerifyIntervalMs` 询问 Slack 一次的探测完成。

工具面属于 Slack，可能在脚下变化。一次改名或一个新工具会以无法识别的名称进入批准门控，门控会征求批准而不会未经审阅就发布；读分类与技能是针对 Slack 公布的界面写的，而不是取自某个真实工作区的枚举。结果不由我们围栏，因为 Slack 自行渲染它们，因此技能指示模型把消息文本当作他人的话语，而没有任何机制像 `native/discord-mcp` 为 Discord 所做的那样强制执行。

## 测试

`packages/host/account-integrations/tests/slack-login.spec.ts` 针对一个 fixture Slack 驱动登录：授权 URL 的 challenge 与其发送的 verifier 匹配、兑换与刷新都不带 `client_secret`、工作区读取、state 不匹配、被拒绝的授权、管理员拒绝、已耗尽的授权、无 JSON 或无令牌的兑换应答、Slack 未命名的工作区、回调端口被占用、超时、兑换过程中的取消、撤销，以及令牌探测。`slack.spec.ts` 固定了连接器 id 派生、重定向、作用域集合与读/写分类。`slack.ts` 与 `slack-login.ts` 的语句、分支与函数覆盖率均为 100%。

连接器技能属于 preset 的一部分，因此会进入每次会话请求：枚举这些技能的无密钥录制会话快照，需在添加技能的同一变更中带密钥重新录制。

没有任何测试会连接真实的 Slack 工作区，也无法做到：工作区必须先批准该应用。因此，所提供工具的名称、每个工具所需的作用域，以及尚未批准该应用的工作区返回的确切错误，是本决策中仍需一次实机验证的部分；在那之前，分类的“默认征求批准”正是让未确认名称保持安全的机制。

## 推迟

用于以带 Aeven 标签的应用发言的机器人令牌界面；Slack 事件监听器，它才可能让该连接器从按需读取变为主动推送；带 `team_id` 的组织级 Enterprise Grid 令牌；以及当 30 天刷新过期成为读者实际撞上的失败时，改用 API 代理的机密客户端。
