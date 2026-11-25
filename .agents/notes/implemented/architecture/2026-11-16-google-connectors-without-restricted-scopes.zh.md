# Agent Note：Google 连接器只请求敏感和非敏感权限

Status: implemented

[English](2026-11-16-google-connectors-without-restricted-scopes.md) | 中文

> Gmail 已不再遵循本 Note：它通过 Google 登录以 `gmail.modify` 读取邮件（[Gmail 通过 Google 登录读取邮件](2026-11-25-gmail-reads-through-google-sign-in.zh.md)）。

## 问题

2026-11-05，Google 对 `aeven-connectors` OAuth 应用的验证未通过“请求最小权限”一步。Gmail 请求了 `mail.google.com`、`gmail.modify`、`gmail.compose`、`gmail.readonly` 和 `gmail.metadata`，Drive 请求了 `drive` 和 `drive.readonly`。Google 把这些都归为受限权限，受限权限每年都要做 CASA 安全评估，所有者拒绝了这一点。Calendar 请求了十二个相互重叠的权限，而完整的 `calendar` 已涵盖另外十一个。

## 决定

每个 Google 连接器请求 Google 归为敏感或非敏感的最宽权限。列表位于 `servers/node` 的 `services/connectors/ConnectorProviders.js`（授权 URL 携带的权限）和 `@aeven/host-account-integrations` 的 `src/google.ts`（授权必须持有、才算已连接的第一个权限）：

- Gmail：`gmail.send` 和 `gmail.labels`。读取和搜索 Gmail 通过现有的 IMAP `email` 连接器和 Google 应用专用密码完成，`gmail` 技能把读取请求转到那里。
- Drive：`drive.file`、`documents`、`spreadsheets`、`presentations`、`forms.body` 和 `forms.responses.readonly`。Drive 操作只能看到用户用 Aeven 创建或打开的文件；Docs、Sheets、Slides 和 Forms 服务可按 ID 打开用户有权访问的任何文件。搜索找不到时，`google-drive` 技能会向用户要链接。
- Calendar：`calendar`。

`servers/node` 的一个单元测试会在 Google 连接器请求受限的 Gmail 或 Drive 权限时失败。

## 考虑过的替代方案

- **通过 CASA。** 所有者拒绝：这是每年重复的付费评估。
- **让 Gmail 读取继续以测试状态走 OAuth。** 拒绝：测试用户计入项目终身 100 位用户的上限，刷新令牌七天后过期。
- **为 Drive 使用 Google Picker。** 推迟：它能把 `drive.file` 扩展到用户选中的文件，但需要在设置和聊天界面中加入选择器。

## 影响

此前的授权不持有 Gmail 或 Drive 新的第一个权限，因此这些连接器会要求用户重新连接。代理不再能通过 OAuth 搜索用户的整个 Drive 或读取 Gmail。
