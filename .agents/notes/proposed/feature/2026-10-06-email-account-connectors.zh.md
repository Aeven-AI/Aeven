# Agent Note: 邮件账户作为连接器

Status: proposed

[English](2026-10-06-email-account-connectors.md) | 中文

## 问题

通过 IMAP 或 POP3 收取、经 SMTP 发出的邮件没有对应的连接器。[账户集成](../../../../packages/host/account-integrations/README.zh.md)的提供方联合类型涵盖 GitHub、Google 服务、Microsoft 365 与自定义 MCP，其中每个连接器都是 OAuth 或 bearer 令牌的 MCP 挂载：创建只携带 `name`、`endpoint` 和一个 `token`，连接器行要求 `endpoint` URL，执行器门禁通过 `mcp__account_<id>__` 前缀识别连接器工具。而一个邮箱需要一个收信绑定、一个可选的发信绑定以及每个绑定的密码，并且一个用户可以连接任意数量的邮箱。

## 方案

每个邮箱是一条 `email` 连接器行，在连接器页面添加。新的邮件能力接缝通过一套共享工具服务所有行，每次调用指定账户。

### 包

- `packages/mail/mail`（`@aeven/mail`）：Service Definition、账户来源注册表，以及 IMAP（`imapflow`）、POP3（`node-pop3`）和 SMTP（`nodemailer`）提供方，MIME 由 `mailparser` 解析。`resolve(owner, account)` 返回连接规格与密钥，或在打开套接字之前拒绝缺失、他人所有、已停用或已断开的账户。每个账户保持一个 IMAP 客户端，直到达到配置的空闲超时或插件释放；POP3 与 SMTP 每次调用单独连接。
- `packages/mail/tool-mail`（`@aeven/tool-mail`）：工具 Consumer。只有会话所有者拥有已启用的邮件账户时，工具才挂载到该 agent，其他用户不承担工具目录开销。
- `@aeven/host-account-integrations` 通过 `ctx.effect()` 把它的 `email` 行注册为账户来源。`@aeven/mail` 从不导入账户集成，`syncConnectors` 跳过 `email` 行，因为它们没有 MCP 挂载。

### 账户行与密钥

提供方联合类型和两个 zod 枚举新增 `email`。连接器行新增可选的 `email` 设置与 `authFailed` 标记，`endpoint` 变为可选；现有行仍可解析，因此 `account_integrations` 存储域版本保持不变。一条 grant 记录保存收信密码，以及不同时的发信密码；两者都不会出现在连接器行、Remote 响应、工具结果或错误中。

```yaml
address: olivier@example.com
aliases: [olivier@alias.example.com]   # allowed From addresses
receive: { protocol: imap | pop3, host, port, security: tls | starttls, username }
send:    { host, port, security: tls | starttls, username }   # optional
```

独立的 `connectEmail` Remote 在保存前探测（连接、认证、列出文件夹、SMTP `EHLO` 与 `AUTH`），并以结果值返回失败原因与步骤，使表单能以本地化文案说明。之后认证失败时会设置 `authFailed`，该账户从 `ctx.mail` 中隐藏，并显示为需要重新添加。

### 工具

| 工具 | 行为 |
| --- | --- |
| `mail_accounts` | 地址、协议、能力（POP3：无文件夹与标记）和状态。 |
| `mail_search` | 只返回信封；按文件夹、日期、发件人、主题和未读过滤；省略 `account` 时搜索全部账户。 |
| `mail_read` | 一封邮件的头部与文本正文；可选的 `saveAttachments` 路径受文件系统策略约束。 |
| `mail_update` | 标记已读或未读、加旗标、移动、归档、移入废纸篓或删除（POP3：仅删除）。 |
| `mail_send` | 通过 SMTP 发送或回复，或以 `draft: true` 追加到草稿箱。每次发送都需要审批；From 必须是该地址或其别名。 |

邮件文本与头部按不可信外部内容包装，与 `tool-web` 使用 `EXTERNAL_WEB_CONTENT_NOTICE` 的方式相同；HTML 转为文本，不获取远程资源。正文字节数、结果数量、附件大小和调用时长是经过校验的 `Config` 字段；超出限制的请求会被拒绝并指明限制。TLS 证书始终校验，明文认证一律拒绝。

### 设置表单

Email 提供方首先询问地址和密码。按域名匹配的预设为 Gmail、Outlook、iCloud、Yahoo 和 Fastmail 填入服务器；高级区域按绑定显示主机、端口、安全模式以及单独的 SMTP 密码。每个账户是独立的一行，拥有各自的开关、状态、重新连接和移除操作。文案通过 `ui-settings-integrations` 的英文与中文语言包提供。

## 分阶段

1. 第一阶段：邮件接缝与提供方、五个工具、`email` 行与探测、设置表单，以及在发布 bundle 中的组合。
2. 第二阶段：通过现有提供方应用为 Gmail 提供 XOAUTH2、autoconfig 自动发现，以及需要独立会话事件的 IMAP IDLE 通知。Outlook 邮件不再属于本阶段：它改为通过委托的 Graph 传输到达（[Microsoft 365 连接器](2026-10-07-microsoft-365-connectors.zh.md)）。

## 考虑过的替代方案

- **一行包含多个账户：** 已否决，因为每账户一行已经提供了逐账户的启用、状态与移除。
- **每个账户一套工具：** 已否决，因为工具 schema 会随每个邮箱在每次请求中增长。
- **包装第三方邮件 MCP 服务器：** 已否决，因为其工具词汇、凭据处理与错误文本都不受我们掌控；自定义 MCP 仍然可用。
- **在 `cordis.yml` 中声明账户：** 已否决，因为它把密钥放进配置，且没有添加或移除流程。

## 验收标准

- 在设置中添加两个或更多带 IMAP 与 SMTP 的邮箱后，可以列出、搜索、读取、更新和发送；一个 POP3 邮箱可以搜索、读取和删除。
- 工具目录在任意账户数量下保持相同大小；已停用、已移除或他人所有的账户会被拒绝。
- `mail_send` 只在审批后才连接 SMTP，并拒绝地址及其别名以外的发件人。
- 验证：`pnpm run typecheck`、通过的 `pnpm run build`，以及针对真实邮箱的实际运行。

## 风险

- IMAP 服务器在文件夹命名、字符集和扩展上各不相同；归档、废纸篓与草稿在每次调用时按 RFC 6154 特殊用途文件夹解析，而不是使用存储的文件夹映射。
- 邮件内容可能携带提示注入；不可信内容包装与每次发送的审批对其加以约束。
- 提供方错误文本可能回显凭据；错误在成为模型可见内容之前会被清理。
