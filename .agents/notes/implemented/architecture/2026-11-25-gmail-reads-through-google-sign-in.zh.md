# Agent Note：Gmail 通过 Google 登录读取邮件

Status: implemented

[English](2026-11-25-gmail-reads-through-google-sign-in.md) | 中文

## 问题

自 [不含受限范围的 Google 连接器](2026-11-16-google-connectors-without-restricted-scopes.zh.md) 起，Gmail 连接器只能发送邮件和管理标签，读取邮件须另行添加使用 Google 应用专用密码的 IMAP 邮箱账户。用户觉得这种拆分令人困惑，应用专用密码也是一道门槛，而能读取 Gmail 的助手只需一次 Google 登录。

## 决定

- Gmail 连接器只请求 `https://www.googleapis.com/auth/gmail.modify`。它通过 Workspace 桥接的 Gmail 工具覆盖阅读、搜索、会话、标签、草稿及发送；只有持有该范围的授权才算已连接，因此仅能发送和管理标签时期的授权会提示重新连接。
- 不请求 `gmail.metadata`：与其他 Gmail 范围一同授予时，Gmail 会拒绝读取完整邮件及 `q` 搜索。
- `gmail.modify` 属于受限范围。在 `aeven-connectors` 应用通过 Google 的 CASA 安全评估之前，Google 会对 Gmail 显示未验证应用页面，并将可授权的用户数量限制为应用生命周期内最多 100 人。其他 Google 连接器保留敏感及非敏感范围，因此无需 CASA 即可通过验证。

## 考虑过的替代方案

- **引导式 IMAP 加应用专用密码** —— 无需任何 Google 审核即可使用 Gmail 的全部功能，但每位用户都须开启两步验证并粘贴 16 位密码；所有者选择了无需这一步的登录方式。
- **IMAP 使用 `https://mail.google.com/` 加 Google 登录** —— 同样属于受限范围，对桥接工具而言并不比 `gmail.modify` 多出任何能力。

## 影响

- 在完成 CASA 评估之前，Gmail 最多供 100 位用户使用，且须经过 Google 的未验证应用页面；其他连接器不受影响。
- IMAP 邮箱连接器仍可用于任何邮件服务商，包括 Gmail。
