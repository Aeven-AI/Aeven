# Agent Note：托管聊天以多个名称提供服务

Status: implemented

[English](2026-11-16-hosted-page-hosts.md) | 中文

## 问题

pink 上的托管 Host 为 chat.aeven.io 提供服务，所有者希望 chat.aeven.app 作为第二个公开名称直接提供同一个 Host，而不是重定向过去。请求防护已经接受 `AVN_HOSTED_TRUSTED_HOSTS` 中以逗号分隔的列表，但 `identity-user-aeven` 会把 `AEVEN_API_URL`（`https://chat.aeven.io/api`）原样写入每个页面。因此从 chat.aeven.app 加载的页面会把登录和账户请求发往 chat.aeven.io：这是跨源请求，Aeven API 的带凭据 CORS 列表会拒绝它，而且 Cookie 属于另一个主机。此前只有回环地址的写法会跟随页面的主机。

## 决定

`@aeven/host-webserver` 新增 `sameDeploymentUrl(configured, origin, hosts)`。当配置 URL 的主机和请求的主机都属于部署自身的公开主机名时，它返回请求主机上的 URL；回环写法仍由 `sameHostLoopbackUrl` 处理，两者共用一个替换主机的辅助函数。`identity-user-aeven` 通过显式的 `pageHosts` 字段接收这些主机名，并用它处理写入页面的每个 URL；托管 bundle 用请求防护所用的同一份列表 `AVN_HOSTED_TRUSTED_HOSTS` 填充 `pageHosts`。chat.aeven.app 上的页面得到 `https://chat.aeven.app/api`，而 aeven.io 的账户套接字、第三方登录和网站 URL 保持不变。

## 考虑过的替代方案

- 在 Cloudflare 把 chat.aeven.app 重定向到 chat.aeven.io。所有者否决：第二个名称应当提供聊天服务，而不是转发。
- 把 chat.aeven.app 加入 Aeven API 的 `CREDENTIALED_ORIGINS`，保留跨源请求。会话 Cookie 在 chat.aeven.app 上将成为第三方 Cookie，Safari 和 Brave 会拦截。
- 把 `apiUrl` 配置为相对路径。Host 自己也会请求 `<apiUrl>/.well-known/jwks.json`，这需要绝对 URL。

## 影响

第三方登录的回调仍在 aeven.io（`WEB_DOMAIN`）上，因此 X、Apple、Google 和各连接器无需新的注册；Aeven API 必须在 `OAUTH_CLIENT_ORIGINS` 中列出每个名称，登录才能返回到它。会话、已安装的网页应用和浏览器存储按名称分开：在一个名称上已登录的用户，在另一个名称上还需再登录一次。

## 验证

`@aeven/host-webserver`、`@aeven/identity-user-aeven` 和托管 bundle 的 `tsc -b` 均通过，配置目录校验通过。直接调用时，`sameDeploymentUrl` 对来自 chat.aeven.app 的请求把 `https://chat.aeven.io/api` 改为 `https://chat.aeven.app/api`，对 chat.aeven.io、未列出的主机以及 `hosts` 为空的情况保持不变；`wss://aeven.io/socket` 和 `https://aeven.io/oauth/x` 原样传递，`http://127.0.0.1:9000` 仍会跟随 `localhost` 页面。
