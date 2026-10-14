# Agent Note: 浏览器原生资源的 Host 账号 cookie

Status: implemented

[English](2026-10-15-host-account-cookies-for-native-resources.md) | 中文

## 问题

identity authority 强制执行登录时，页面使用 JavaScript 持有的 bearer 认证 Host RPC。Aeven refresh cookie 属于上游 API，Host 启动 cookie 不授予账号身份。浏览器原生图片、文件和视频请求无法附带该 bearer，因此 Host 对这些资源读取返回 401（[issues 83 和 84](https://github.com/Aeven-AI/Aeven/issues/83)）。

## 决策

`/api` 下每个获准的 bearer 请求（包括 `HEAD /api/credential`）都会续签 host-only 的 `avn-account-<authority hash>` cookie。`BrowserAuth` 使用持久化的 `client-connection/browser-session` 密钥签署 `{version, authority, userId, issuedAt, expiresAt}`。验证检查签名、精确 authority、签发时间、过期时间，以及该类型自身的 12 小时有效期上限。属性为 `HttpOnly; SameSite=Strict; Path=/api`，针对 loopback HTTP 不设置 `Secure`。常规 API 流量会重新签发该 cookie，因此较短的有效期既让它保持新鲜，也限定了退出登录的账号还能读取资源字节的时长。

请求围栏先解析身份凭据，仅在没有 Authorization 时才读取账号 cookie。只有已注册精确 Fetch 路由上的 `GET` 和 `HEAD` 才会被账号 cookie 放行——即浏览器自行加载的字节路由，例如 `/api/file`、`/api/attachment-file` 与 `/api/attachment-image`——并通过 `identityUsers.runAs({id: userId}, work)` 执行，因此账号所有权检查保留调用者。RPC 通道、WebSocket 流以及所有其他方法仍需页面自身的凭据，因此该 cookie 绝不会成为通往工具型 API 的第二把钥匙。identity authority 强制执行身份认证时，启动 cookie 仍不可用，保留[每账号隔离](../architecture/2026-09-30-per-account-isolation-on-a-shared-host.zh.md)。

资源 URL 保持可直接打开，并保留 attachment-file 路由用于视频跳转的 Range 支持。Markdown 本地路径相对于 HTTP(S) 和 `avn-app:` origin 解析。

## 考虑过的替代方案

**把资源字节加载为浏览器 blob。** 这需要为每个图片、视频、文件打开和侧边栏消费者分别接线，并替换可直接打开的资源 URL。

**身份强制认证时接受启动 cookie。** 它不标识账号，无法支持账号所有权检查。

## 影响

浏览器原生子资源读取使用该 origin 最后存储的账号 cookie：这些读取以最后登录的账号为准，之后每个获准的 bearer 请求都可再次替换 cookie。提供页面 bearer 的 RPC 和 WebSocket 请求保留该页面的身份。即使上游 bearer 过期或页面退出登录，Host 账号 cookie 仍有效直到自身过期——最长不超过最后一个获准 bearer 请求之后的 12 小时；轮换签名记录会在 Connection 重新激活时生效。

桌面 spawn 模式通过 `dispatchApi` 分发 `avn-app://app` 字节请求，不经过 `requestRejection`；其已有的未认证字节路由仍属于独立工作。围栏测试不覆盖桌面 attach/spawn 渲染、工具预览、文件打开、视频播放与跳转以及侧边栏图片；这些需要手工验证。

## 验证

围栏测试覆盖 cookie 签发与续签、持久化密钥验证、过期、错误 authority、伪造签名、拒绝启动 cookie、显式 bearer 优先、通过真实 identity 服务进行账号归属，以及该 cookie 自身的放行边界：已注册字节路由上的 `GET` 和 `HEAD` 放行，其他方法、RPC 路径以及完全不声明请求行的请求一律拒绝。浏览器图片 URL 和附件 Range 实现保持完整。
