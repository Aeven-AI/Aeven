---
description: "设置中的个人技能和连接器页面。"
kind: "package-reference"
---

# @aeven/client-ui-settings-integrations

[English](README.md) | 中文

## Summary

设置为已登录用户提供独立的技能和连接器页面。技能列出账户自己的技能——导入的包与已安装的技能——并提供指令查看。技能与连接器采用相同布局：搜索框旁为导入按钮，下方每行显示名称、描述及一个账户调用开关。每行打开地址为 `#!/settings/skills/<skill id>` 的页面，包含开关、渲染后的指令、资源文件及移除操作；设置页眉中的圆形返回控件回到列表。技能和连接器页面的文字不超过 16px，字重不超过 500，渲染的指令也不例外。连接器技能仅在对应连接器详情中显示，不提供单独开关；指令在可滚动的弹窗中显示并提供关闭按钮，表格不提供复制或全屏控件。令牌连接表单打开时聚焦名称字段，使其在可滚动的设置面板中可见。已配置提供方的登录为主要操作，在 Electron 中通过系统浏览器打开授权，在 Web 中通过新标签页打开。页面保留继续登录链接，并在用户返回应用或主机因连接变更使技能目录失效时刷新账户状态。较早的列表响应不能覆盖较新的刷新结果。每个连接器行在圆形黑色徽标中显示品牌标识，并只有一个开关：已登录的连接可在对话中使用时开关为开。开启时会开始登录，或为未配置登录的 GitHub 和自定义 MCP 打开令牌表单；关闭时会断开连接并删除已保存的凭据，因此不存在暂停状态。此规则之前被禁用的连接再次开启时无需重新登录。每行打开地址为 `#!/settings/connectors/<provider>` 的详情页，因此可以直接链接，浏览器返回可回到列表。详情页包含同一个开关、令牌表单及连接器的技能；自定义 MCP 为每个服务器提供移除操作。详情不显示目录标题；圆形返回控件位于设置页眉。连接器展示 GitHub、Gmail、Google 云端硬盘、Google 日历、Outlook、Outlook 日历、OneDrive、SharePoint、Teams、邮件账户、WhatsApp 号码、Telegram 账户、Discord 服务器、Slack 工作区和自定义 MCP 连接，并提供账户所属的管理操作。邮件、WhatsApp、Telegram 和 Discord 各自按账户、号码、已登录账户或 Discord 服务器保留一个连接，因此其页面列出这些行，每行带有开关和移除操作，并有添加另一个的按钮：账户表单、二维码、登录或 Discord 安装页面。Slack 每个工作区保留一个连接，并使用常规提供方页面：其开关用于登录某个工作区，或断开该提供方已连接的所有工作区。

Microsoft 连接行显示已验证的账户地址。需要管理员批准的授权显示专门提示及应用批准链接；普通授权失败或授权过期可重新登录。SharePoint 和 Teams 需要工作账户。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Web bundle 包含这两个页面。打开设置，再选择技能或连接器。导入 SKILL.md 或技能包；展开指令即可查看内容和资源列表。自定义 MCP 连接表单接受名称、服务器 URL 和可选的仅写 bearer token。GitHub 可通过个人访问令牌使用其官方 MCP 地址。提供方登录链接仅在[主机应用配置](../../host/account-integrations/README.zh.md)可用后出现；未配置的提供方会说明所需设置。

## Understand the implementation

<details>
<summary>实现内部机制</summary>

插件贡献两个 settings.section 条目，使用 locale 所属的英文和中文文案。浏览器回调使用 accountIntegrations Remote；页面不接受账户 ID 或已保存秘密。技能库涵盖整个账户，且不读取对话状态。列出的每个技能都由账户拥有，并提供启用开关。页面在打开、成功更改后及窗口重新获得焦点时重新加载。此页面直接展示权威 Remote 快照且没有第二套注册表，因此不发布 invariant 伴随插件。

</details>

## Model Experience

None, as 这些页面仅通过主机 Remote 管理集成。

#### KV Cache effect

None; no prompt input originates here.

## Known Limitations and Deferred Work

- 在打开的链接中完成提供方授权，再返回 Aeven 显示已保存的连接。
- 已保存的授权状态不会持续监测服务器可达性。

### Dev Note

主机包负责存储、凭据处理及对话工具 scope。
