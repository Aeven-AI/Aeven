# Agent Note：X 登录在手机上不再被 X 应用打断

Status: implemented

[English](2026-11-11-x-sign-in-survives-the-x-app.md) | 中文

## 问题

2026-11-11，在 Android 手机的 Chrome 上通过 chat.aeven.io 使用 X 登录失败。经 USB 调试观察到：按下按钮后 Chrome 前往 `aeven.io/oauth/x`，它重定向到 `x.com/i/oauth2/authorize`。Android 用 X 应用打开了这个地址，X 应用是 x.com、twitter.com 及其 www 和 mobile 主机的已验证处理程序。点击 Authorize 后，X 应用在 Brave 的自定义标签页中打开回调 `aeven.io/oauth/x/check`。Brave 没有 Chrome 的任何 Cookie，因此 passport-oauth2 的会话存储找不到 PKCE 验证串并拒绝了 state，服务器退回到配置的结果页面：“Oops! … please try again”。Chrome 标签页停在登录界面，X 按钮一直转圈。

## 决策

X 策略把 PKCE 验证串以 `state` 为键保存在 Redis 中（servers/node 的 `HandoffStateStore`）。该 state 是 `OAuthRedirectTarget.stateFor` 签名后的值，并像以前一样绑定到发起登录的会话。来自该会话之外的回调，只有当 state 是为交接而签名时才能通过验证。登录界面以 `app=web` 和一个验证串的 SHA-256 开始 X 登录，签名的 state 携带 `web:<nonce>`。在另一个浏览器中到达的回调，会通过桌面交接存储把 session/challenge 对存放在该 nonce 下，并停在服务器的已登录页面。等待中的页面从 `/oauth/desktop/claim` 取回这一对，并经 `/oauth-result` 完成登录。在发起登录的浏览器中到达的回调照旧重定向。

同一改动还为登录页头加了 `brandUrl` 链接（托管包中设为 aeven.io），以及一个把选择保存在浏览器存储中、只作用于这些界面的语言控件。它还去掉了这些界面上链接的下划线。

## 考虑过的替代方案

在手机上测试过一个不经点击就转到 X 的中间页面，Chrome 仍把 x.com 交给了 X 应用，因为它把这次转发算作点击的一部分。X 只在 X 应用声明的主机上提供授权页面：`api.x.com` 和 `api.twitter.com` 返回 400，`twitter.com` 重定向到 x.com。关闭 X 应用的链接处理只能修好一台设备。

## 影响

回调到达另一个浏览器的 X 登录，不再让那个浏览器登录；登录的是发起它的页面，另一个浏览器显示服务器的已登录页面。Apple 和 Google 保留 passport 的会话存储，在网页上从不交接。登录界面的语言选择不会带入登录后的应用。

## 验证

servers/node 的 passport 单元测试（157 个）通过，其中包括一个回调来自没有会话 Cookie 的新浏览器的完整 X 流程。aeven 客户端类型检查与构建通过。在本地 `avn web` 上，按下 X 会轮询取回路由，并经 `aeven.io/oauth/x?app=web&nonce=…` 跳转；徽记链接到 `https://aeven.io/`；语言控件在手机宽度下由白色变为黑色。完整的手机流程有待 servers/node 部署后验证。
