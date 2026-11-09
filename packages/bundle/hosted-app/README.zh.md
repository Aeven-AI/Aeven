---
description: "avn 托管版 bundle：面向 Aeven 自己运营、服务多个账号的 Host，把 Web 补丁层收窄——不在按账户监狱之外执行任何命令，也不在 Host 自己的机器上执行文件操作，也不保留任何能被一个账号改到其他账号的设置。"
kind: "package-bundle"
---

# @aeven/hosted-app

[English](README.md) | 中文

## 概述

`@aeven/hosted-app` 是用一个 Host 向许多人提供 Aeven Web 时的 bundle 层。它叠加在 `@aeven/web-app` 之后，并把两条规则写成行：会话不在 Host 自己的机器上运行任何东西，一个账号改动的任何东西也不作用于另一个账号。文件系统、终端、Host 的浏览器、设备、computer-use、代码运行时、workflow 工作线程、代码子代理、技能目录与工作区文件夹关闭；`preview_*` 浏览器工具保留，并通过 Aeven 扩展作用于读者自己的浏览器，shell 只在 `AVN_HOSTED_SANDBOX=1` 时运行，每条命令都在其账户的[监狱](../../sandbox/sandbox-jail/README.zh.md)中；网页搜索与抓取、imagine、附件、记忆以及同进程内的子代理委派保留。账号设置按登录账号解析，同步提供者为每个在此登录的账号保持一条加密连接。每个页面还会把边缘 `countryHeader`（Cloudflare 的 `cf-ipcountry`）给出的读者国家写成 `__AVN_READER_COUNTRY__`，作为 WhatsApp 国家代码框的初始值。本 bundle 以 info 级别挂载控制台日志器，使 Host 插件的警告与错误进入服务日志。

以 `avn hosted` 启动，它组合 base、web 与这个 bundle，端口默认 3085，除非 `AVN_HOSTED_PORT` 指定另一个。`AVN_HOME` 决定这次部署把状态放在哪里，`AVN_HOSTED_HOST` 决定服务器绑定的地址，`AVN_HOSTED_TRUSTED_HOSTS` 决定浏览器可以用哪些公开名字访问它；TLS、公开名字与请求限制属于前面的代理。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

只支持用 `avn hosted` 启动。部署把 `AEVEN_API_URL` 与 `AEVEN_SYNC_URL` 指向它服务的 API 与中继，在 `AVN_HOSTED_TRUSTED_HOSTS` 中写明公开主机名，并让代理指向绑定地址，同时为 `/sync` 与客户端 socket 打开 WebSocket 升级。会话、工作区、记忆、个人化、自动化、连接器、邮件与同步都按登录账号归属；通过浏览器发起的设置写入会被拒绝，因为设置文档属于 Host。

<a id="understand-the-implementation"></a>
## 理解实现

这个 bundle 就是叠加在 Web 层之上的一份 `cordis.patch.yml`。补丁会替换目标行的整个 `config`，所以这里的每一行都重述它拥有的全部键，预设的工具行也在同一个文件中一并禁用，免得某个预设把它们重新打开。`src/limits.ts` 按账号和总量准入模型流，把请求排在该账号自己的队列后面，并拒绝超过任一上限的请求。

<a id="further-exploration"></a>
## 进一步探索

- [Agent Note：多账号的托管版 Aeven Web](../../../.agents/notes/implemented/feature/2026-11-05-hosted-web-host.zh.md)
- [Web app bundle](../web-app/README.zh.md)

<a id="model-experience"></a>
## 模型体验

无。本 bundle 不增加任何自己的提示词段落或工具：它移除会触及 Host 机器的工具，因此托管会话的模型只看到对话、网页、记忆与附件相关工具。

#### KV Cache 影响

本身没有；请求沿用其余工具与系统提示词已经形成的缓存。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **公开注册尚无配额与速率限制**——请求准入只限制每账号与总量的并发流，不限制建号、花费或请求频率。
- **账号数据没有静态加密**——每个账号的会话、记忆与同步数据库都在部署家目录下各自的目录里，运营 Host 的人可以读取。
- **代码只在账户的监狱中运行**——没有 `AVN_HOSTED_SANDBOX=1` 时，托管会话不能运行命令；有它时，命令在磁盘受限的账户文件夹中运行，只能通过监狱的出站代理访问 GitHub、npm registry 和 PyPI，代理限制每个账户的连接数和字节数，命令列为输出的文件在调用处展示，上传的文件以只读方式挂载，模型可以读取该文件夹中的文件与图片，Files 侧栏以只读方式显示它，而文件写入、文件搜索和 Host 的浏览器保持关闭。
- **图片按会话提供**——部署拒绝仅凭指纹的读取，因此托管图片没有永久缓存 URL。
- **记忆工作只是受限而非隔离**——嵌入在 Host 进程内运行，一个账号的大量追平仍会占用其他账号的时延。


### 开发备注

不发布 invariant 伴随模块：这个 bundle 不拥有独立的运行时关系，只是它自己的组合与测试所观察的行配置。
