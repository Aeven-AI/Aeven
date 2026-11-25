# Agent Note：在托管宿主上登录 Slack

Status: implemented

[English](2026-11-25-slack-sign-in-on-the-hosted-host.md) | 中文

## 问题

Slack 的登录在宿主上运行，使用回环重定向 `http://127.0.0.1:<slackCallbackPort>/callback`。在桌面宿主上，浏览器运行在同一台电脑上，因此重定向能到达监听器。在托管宿主上，浏览器运行在用户的电脑上，而宿主运行在服务器上，因此 Slack 会把浏览器送往一个无人监听的回环地址，chat.aeven.io 也就无法提供 Slack 连接器。

## 决定

- 浏览器通过网络访问的宿主将 `slackRedirectUrl` 设为其自身 Web 服务器上的公开 HTTPS 路由；托管包使用 `https://chat.aeven.io/connectors/slack/callback`，Slack 应用将其与回环地址一同注册。
- 设置该字段后，`authorize('slack')` 向 `startSlackLogin` 传入 `SlackCallbackRelay`，而不绑定回环端口。该路由按重定向的 `state` 找到对应登录，以与回环监听器相同的页面答复浏览器，并把授权码交给该登录；兑换、工作区校验及按工作区划分的连接器行均保持不变。
- 若某个重定向的 `state` 没有登录在等待，它会得到“并非来自 Aeven 打开的窗口”页面，且不会结算任何登录。

## 考虑过的替代方案

- **通过 Aeven API 代理 Slack** —— 会把每个 Slack 令牌移到 API 上，但 Slack 的连接器 id 由授权后才知道的 team id 派生，宿主也已自行刷新并探测其 Slack 令牌；公开路由无需这些改动即可达到同样效果。
- **在托管宿主上使用回环** —— 浏览器永远无法访问服务器的回环接口。

## 影响

- Slack 应用必须注册 `https://chat.aeven.io/connectors/slack/callback`，托管宿主需要在 `SLACK_CLIENT_ID` 中提供该应用的公开客户端 id。
- 桌面宿主继续使用回环重定向。
