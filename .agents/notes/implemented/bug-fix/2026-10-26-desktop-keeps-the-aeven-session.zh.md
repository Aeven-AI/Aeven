# Agent Note：桌面外壳保持 Aeven 会话

Status: implemented

[English](2026-10-26-desktop-keeps-the-aeven-session.md) | 中文

## 问题

桌面读者在登出之前应一直保持登录。有四条路径会结束或削弱会话：

- 只有打开的窗口会续期两小时的 access token。后台模式会在没有窗口时让外壳及其 Host 继续运行，而 Host 会代表读者把 access token 出示给 Aeven 的模型路由，因此最后一个窗口关闭后两小时内，自动化任务就会失去 Aeven 模型。
- Host 只在内存中保存 API 的公钥。在 Aeven 不可达时启动的 Host 无法校验任何人；断网期间 access token 失效后，窗口没有 Host 接受的凭据，读者被送到登录界面。
- 网关的 cookie 认证和 WebSocket 升级接受任何签名有效的 refresh token，因此已登出或已重置密码的会话在那里还能继续使用长达一年。
- Electron 延迟把 cookie 写入磁盘。轮换后不久崩溃，可能恢复出一个超过 60 秒复用宽限期后被 API 拒绝的 refresh token。

## 决定

外壳的主进程在与窗口共享的 cookie 存储中保持会话（[aeven-session.ts](../../../../apps/desktop/src/aeven-session.ts)）。无论是否有窗口，它都在 access token 失效前五分钟续期，并把每个 token 交给 Host 的凭据交接路由；每次续期都会轮换一年期的 refresh token。每当 refresh cookie 变化，它都把 cookie 存储写入磁盘，并把该 cookie 镜像到 Host 的回环 origin。窗口没有新的 access token 时，其请求携带镜像的 cookie，由 [`identity-user-aeven`](../../../../packages/identity/user-aeven/README.zh.md) 在本地校验。该 authority 现在把最近的密钥集保存在 `jwksCacheFile` 中，从它启动并在后台刷新。网关（`servers/node`，`services/AuthService.js`）在 cookie 和 WebSocket 路径上要求会话记录持有该 refresh token，并采用与 `/refresh-token` 相同的复用宽限期。

首次登录仍然需要 Aeven：没有其他途径能确认读者是谁。

## 考虑过的替代方案

**把 refresh token 交给窗口。** 窗口脚本随后可以出示它，但该 token 是 `httpOnly`，正是为了让页面脚本读不到它。

**离线时接受过期的 access token。** Host 无法区分断网与会话已被吊销，每个过期 token 都会变成凭据。

## 影响

运行中的外壳会无限期续期；之前登录过的读者在 refresh token 的一年有效期内，无论断网多久都保持登录。在别处被吊销的会话会在离线机器上继续有效，直到它重新联网；之后的下一次续期被拒绝，API 清除 cookie，镜像随之清除。窗口自己的续期与外壳的续期可能同时发生；网关的复用宽限期会用轮换后的 token 回答较晚的那一次。由 `avn web` 启动的被接管 Host 也以同样方式保持，前提是它以相同的 API 组合了 `identity-user-aeven`。
