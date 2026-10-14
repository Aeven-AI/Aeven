# Agent Note: Remote stream socket 由页面自身的 bearer 识别

Status: implemented

[English](2026-10-14-socket-identity-from-page-bearer.md) | 中文

## 问题

读者用 Google 登录 Web 客户端后，在侧边栏看到了另一个账号的文件夹，旁边还有一个装着自己 Session 的 Ungrouped 分组。页面通过两种可能指向不同账号的凭据访问 Host。HTTP 调用以 `Authorization` 携带页面的 access token。`/api/remote.mux` WebSocket 无法携带 header，因此 `identity-user-aeven` 在升级时凭 `refreshToken` cookie 识别它一次，并在 socket 的整个生命周期内沿用。该 cookie 以主机为作用域：`localhost` 上的所有标签页和端口共享它，它指向最后登录的那个账号。Workspace feed 运行在 socket 上，因此列出了邮箱账号的 Workspace；而通过 HTTP 的 Session 列表列出的是 Google 账号的 Session。这些 Session 都不属于 socket 账号可见的任何 Workspace，于是落入 Ungrouped。

这种混合视图还会跨账号写入。页面提供了邮箱账号的文件夹，`session.create` 把 Google 账号的新 Session 挂到了它下面，因为 `create` 解析指定的 Workspace 时没有执行 `move` 所做的所有者检查。

## 决策

socket 出示页面自身的 bearer。`ui-auth-aeven` 在其 `fetch` 钩子旁安装 `ClientTransportHooks.socketCredential`，并以 `ctx.connection.socketCredential` 暴露。`RemoteStreamMuxClient` 在每次尝试时读取它，并以子协议提供 `avn.remote` 与 `avn.bearer.<token>`。Host 的升级路由把 bearer 子协议映射为 `Authorization`，并从围栏与 identity seam 读取的 header 中去掉 `cookie`（`remoteStreamTrustRequest`），WebSocket 服务器选择 `avn.remote`。页面不持有 bearer 时该钩子会拒绝，使该次尝试失败并由 Connection 重试，而不是凭 cookie 打开 socket。

`identity-user-aeven` 让出示的 bearer 单独决定。无效或过期的 bearer 谁也不指明，不再回退到 cookie，客户端现有的 401 路径会续期并重试。cookie 只识别不带 bearer 的请求。

`session.create` 对调用方无权访问的 Workspace 回答 `workspace/not-found`，与 `move` 一致。

## 考虑过的替代方案

**把 bearer 放进 socket URL 查询参数。** 否决：URL 会进入日志和历史记录，而该 token 是有效的会话凭据。

**首帧认证消息。** 否决：mux 协议没有未认证阶段，而围栏在任何帧出现之前就于升级时作答。

**通过 HTTP 签发短期票据。** 暂时否决：它要增加一个 Host 端点和票据状态，来携带 access token 已经携带的同一事实。

## 后果

Aeven API 中断期间，access token 过期后 HTTP 仍会回退到 cookie。在此期间重连的 socket 会等待下一次续期，因为 cookie 无法证明它属于本页面的账号。设备 hub socket 由围栏接纳，但不携带按账号的身份，因此不变。已经挂到其他账号 Workspace 下的 Session 会留在那里直到被移动；对其所有者而言，它们显示在 Ungrouped 下。
