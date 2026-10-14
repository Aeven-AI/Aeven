---
description: "邮件能力服务（ctx.mail）：账户来源、按所有者限定的 IMAP/POP3/SMTP 操作、限制与失败分类。"
kind: "package-reference"
---

# @aeven/mail

[English](README.md) | 中文

## 概述

`@aeven/mail` 注册 `ctx.mail`，为一个所有者的账户运行邮件操作：列出账户与文件夹、搜索信封、读取一封邮件、读取一个附件、更改邮件状态、发送或保存草稿，以及试探新账户设置。账户来自已注册的 `MailAccountSource`；每个操作在打开套接字之前，都会按给定所有者对来源解析所指定的账户地址，因此缺失、已禁用、已移除或属于他人的账户在这里就被拒绝，而不是靠工具可见性来拒绝。提供方使用受维护的库——`imapflow`、`node-pop3`、`nodemailer` 与 `mailparser`——除每个账户一条池化的 IMAP 连接之外不缓存任何东西。

## 使用本包

在 host 组合中挂载该服务，并注册一个账户来源；`@aeven/host-account-integrations` 为 Email 连接器这样做。

```yaml
- name: '@aeven/mail'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `30000` | 每条连接的 TCP、TLS 与问候预算 |
| `socketTimeoutMs` | `120000` | 套接字空闲预算 |
| `idleTimeoutMs` | `300000` | 未使用的 IMAP 连接保持打开多久 |
| `searchMaxResults` | `50` | 一次搜索返回信封数量的上限 |
| `bodyMaxChars` | `20000` | 一次读取返回正文字符数的上限 |
| `messageMaxBytes` | `26214400` | 可读取或可保存附件的最大邮件 |
| `pop3ScanLimit` | `200` | 一次搜索读取其头部的最近 POP3 邮件数 |
| `sendsPerHour` | `30` | 一个账户在滚动一小时内可发送的邮件数 |

## 行为

- **安全。** 绑定使用隐式 TLS 或强制的 STARTTLS；证书始终验证，且从不提供明文认证。POP3 只支持隐式 TLS。
- **错误。** 失败是 `MailError`，每个分类一条固定消息（`MAIL_AUTHENTICATION`、`MAIL_CONNECTION`、`MAIL_TLS`、`MAIL_LIMIT` 等）。服务器响应文本被丢弃，因为它可能回显凭据或邮件内容。认证失败会调用来源的 `authenticationFailed`，来源在被替换之前停止列出该账户。
- **IMAP。** 搜索只读取信封，按最新在前，受 `searchMaxResults` 约束；读取会抓取来源而不设置 `\Seen`。归档、垃圾箱与草稿解析 RFC 6154 的 special-use 文件夹，服务器没有时会被拒绝。
- **POP3。** 邮箱只有 `INBOX`。搜索扫描最新的 `pop3ScanLimit` 个头部，支持 from、to、subject、since 与 before；`delete` 是唯一的更新操作，并在 QUIT 时提交。草稿被拒绝。
- **SMTP。** 发件人必须是账户地址或别名。回复会从原邮件设置 `In-Reply-To` 与 `References`，并把主题默认为 `Re: …`。超过 `sendsPerHour` 的发送被拒绝。
- **试探。** `probe(settings, secret)` 在接收服务器上连接、认证并列出文件夹，然后在发送服务器上连接并认证；抛出的 `MailError.step` 指出失败的步骤。

## 模型体验

### 账户拒绝

#### 模型看到什么

本服务自己不渲染任何提示词或工具文本；模型通过 [`@aeven/tool-mail`](../tool-mail/README.zh.md) 读取它的结果与错误，工具 schema 与结果文本由后者拥有。每个操作在打开套接字之前都会按调用方所有者账户的来源解析所指定的账户地址，因此缺失、已禁用、已移除或属于他人的账户在这里就被拒绝，而不是靠工具可见性来拒绝。模型随后读到 `No mail account is connected. Add one in Settings → Connectors → Email.`、`No connected mail account is ${address}. Connected accounts: ${known}.`、`More than one connected account uses ${address}.` 或 `This account was removed. Add it again in Settings.` 之一，由调用的工具逐字传递。

#### Token 影响

一次被拒绝的调用向 transcript（文本记录）添加这些固定句子之一，不带任何结果正文；它会留到压缩为止。

#### KV Cache 影响

仅追加；该句子作为工具结果到达，位于可复用的请求前缀之后。

### 失败消息

#### 模型看到什么

本服务抛出或重新抛出的失败是携带一条固定句子与一个分类代码的 `MailError`，调用的工具逐字返回该句子。服务器响应文本被丢弃，因为它可能回显凭据或邮件内容，因此模型永远读不到它。这些固定句子包括 `The incoming mail server rejected the username or password.`、`The incoming mail server could not be reached. Check the host, port, and security setting.`、`A secure connection to the outgoing mail server could not be verified. Check the host name and security setting.`、`The folder does not exist.`、`The outgoing mail server rejected the sender or every recipient.`、`The message is ${size} bytes, above the ${max}-byte limit.`、`This account has no archive folder; move the messages to a folder instead.`、`This account has no trash folder; use delete instead.`、`This account has no Drafts folder.`、`POP3 accounts support delete only; they have no flags or folders.`、`POP3 accounts have only the INBOX folder.`、`${from} is not an address of this account. Use ${addresses}.` 与 `This account reached its limit of ${sendsPerHour} messages per hour.` 认证失败还会调用来源的 `authenticationFailed`，来源在被替换之前停止列出该账户。

#### Token 影响

只有失败的调用会添加这些句子之一，每次调用一次，保留到压缩为止。

#### KV Cache 影响

仅追加；该句子作为工具结果到达，位于可复用的请求前缀之后。

### 结果界限

#### 模型看到什么

一次搜索最多返回 `searchMaxResults` 个最新在前的信封与一个 `truncated` 标志；跨所有账户的搜索会为每个失败的账户添加一行 `${account} could not be searched: ${error}`，并且只有在每个账户都失败时才整体失败。一次读取返回头部与最多 `bodyMaxChars` 个字符的纯文本正文，并带 `truncated` 标志，它的附件清单携带序号、名称、内容类型与大小。超过 `messageMaxBytes` 的邮件会被拒绝，而不是被返回；POP3 搜索只读取最新的 `pop3ScanLimit` 个头部。

#### Token 影响

这些是每次调用对工具可放入 transcript 的内容的上限：`searchMaxResults` 个信封、`bodyMaxChars` 个正文字符、`pop3ScanLimit` 个被扫描的头部。除上面的固定提示外，本服务不添加自己的文本。

#### KV Cache 影响

仅追加；每条结果都是可复用的请求前缀之后的工具结果。

## 已知限制与延期工作

- 只支持密码与应用专用密码认证；Gmail 与 Outlook 的 XOAUTH2 已延期。
- 已发送邮件不会追加到 Sent 文件夹；多数托管提供方自己保存已提交的邮件。
- 没有服务器自动发现，也没有 IMAP IDLE 通知。
- 发送速率窗口保存在内存中，插件重启时重置。
- **不变量省略** —— 不发布运行时不变量伴随模块，因为本服务拥有的可变状态——来源注册表、按账户池化的 IMAP 连接与滚动发送窗口——只由读取它们的操作写入，因此监听器只会重复它所声称要校验的那次调用；本服务承诺的是与各邮件服务器之间的套接字对话，没有任何进程内观察能代替它。
