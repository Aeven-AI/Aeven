---
description: "会话工作目录作为被记录的容量：头部 cwd 被子可重放的 session/cwd 变更覆盖，并提供解析与切换操作供 shell 工具解析工作目录。"
kind: "package-reference"
---

# @aeven/working-directory

[English](README.md) | 中文

会话的工作目录作为一个被记录的容量。每个解析相对路径的工具都向该服务询问，而不是读取会话头部。

## 概述

`@aeven/working-directory` 为整个 harness 回答一个问题：这个会话现在在哪个目录里工作？会话在记录于不可变头部元数据的目录中创建，但工作会移动——进入子目录、新的检出、工作树——因此服务把最后记录的 `session/cwd` 折叠到该头部之上，并相对于结果解析相对路径。shell 工具向它询问工作目录，`@aeven/tool-working-directory` 把同一容量暴露给模型。凡是会话目录必须变化并要在恢复、分叉与重放之后仍然成立的地方都适用。

## 目录

- [契约](#contract)
- [操作](#operations)
- [消费者](#consumers)
- [已知局限与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="contract"></a>
## 契约

会话在某个目录中创建，而该创建路径是不可变的头部元数据（`SessionHeader.cwd`）。工作会移动：进入子目录、进入新的检出、进入工作树。因此生效的目录是

```
service.of(session) = last logged session/cwd ?? session.header.cwd
```

`session/cwd` 携带绝对目录，只进日志、非 surface，按最后一条重放，因此恢复与分叉都会还原日志记录的目录。头部没有目录、日志也没有变更的会话没有工作目录，`of()` 返回 `undefined` 而不是凭空造一个。

`workingDirectory` 投影单元为客户端折叠同一批事件。

<a id="operations"></a>
## 操作

- `of(session)` —— 生效的目录，或 `undefined`。
- `resolve(session, path)` —— 绝对路径做规范化；相对路径相对于 `of()` 解析（会话没有目录时回退到进程目录）。不访问文件系统。
- `change(session, target)` —— 解析、要求目标存在且是目录、追加 `session/cwd`、返回绝对路径。空目标、缺失路径或普通文件会抛错，错误信息点出该路径。目标已在生效状态时不追加任何事件。

<a id="consumers"></a>
## 消费者

`tool-bash`、`tool-bash-persistent`、`tool-pwsh` 与 `tool-pwsh-persistent` 通过 `ctx.get('workingDirectory')?.of(session)` 解析工作目录，并以头部作为回退。该查找是可选的，因此没有本插件的组合仍保持头部行为。

`@aeven/tool-working-directory` 把同一容量以 `working_directory` 暴露给模型。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与后续工作

- 只有四个 shell 工具和本包的工具通过该服务解析。直接读取 `session.header.cwd` 的文件、搜索和 MCP 工具仍固定在创建目录；把它们迁到 `ctx.get('workingDirectory')?.of(session)` 是机械工作，属于需要它的工作树工作。
- 没有目录栈：`change` 是一个最后写入者胜的单一值，离开目录的模型通过指出上一个路径返回。
- `change` 校验目标存在，但不把它限制在沙箱根内。受限组合必须在拥有限制的策略中拒绝根外目标。

<a id="dev-note"></a>
## 开发备注

该服务不发布 `./invariant` 伴随文件。它唯一拥有的关系——投影与 `of()` 一致——在单元规格里对真实会话日志进行观察，不存在可能与之偏离的独立观察。

`of()` 返回 `undefined`，而不是回退到进程目录，因此没有 `cwd` 创建的会话是明确未定的，而不是悄悄继承宿主恰好启动的位置。工具把这一点转成可执行的提示；`resolve()` 是唯一回退的地方，且仅因为调用方需要一个它要用的路径。

消费者使用 `ctx.get('workingDirectory')` 而非声明的注入，因为该插件在组合中是可选的：没有它的 profile 保持头部行为，而不是加载失败。
