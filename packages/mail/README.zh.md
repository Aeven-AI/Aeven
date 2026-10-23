---
description: "mail 能力家族的包映射：IMAP/POP3/SMTP 服务与面向模型的邮件工具。"
kind: "package-group"
---

# mail/ — 邮件能力家族

[English](README.md) | 中文

## 概述

`mail/` 分组让 agent（智能体）访问用户自己的邮箱：经 IMAP 或 POP3 接收，经 SMTP 发送。账户不在这里配置：注册在 `ctx.mail` 上的账户来源按已登录所有者提供它们，而[账户集成](../host/account-integrations/README.zh.md)就是在 Settings 中添加的 Email 连接器的那个来源。一套工具服务所有账户，因此无论有多少邮箱，模型的工具目录都保持同样大小。

## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`mail/`](mail/README.zh.md) | 账户来源注册表，外加 IMAP、POP3 与 SMTP 提供方 | `ctx.mail` |
| [`tool-mail/`](tool-mail/README.zh.md) | `mail_accounts`、`mail_search`、`mail_read`、`mail_update`、`mail_send` | — |

## 相关文档

- [邮件子系统](../../docs/subsystems/mail.zh.md) —— `ctx.mail` 的账户来源注册表、它的文件夹、搜索、读取、附件、更新、发送与探测操作，以及固定的错误分类。
- [邮件账户连接器 Agent Note](../../.agents/notes/proposed/feature/2026-10-06-email-account-connectors.zh.md) —— 账户来源背后的计划与被否决的替代方案。
