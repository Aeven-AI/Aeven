---
description: "设置中的个人技能和连接器页面。"
kind: "package-reference"
---

# @aeven/client-ui-settings-integrations

[English](README.md) | 中文

## Summary

设置为已登录用户提供独立的技能和连接器页面。技能列出账户的个人导入、已安装技能及所有所属文件夹工作区中的技能，并提供来源标签和指令查看。连接器之外的技能提供持久化的账户调用开关。连接器技能仅在对应连接器详情中显示，不提供单独开关；指令在可滚动的弹窗中显示并提供关闭按钮，表格不提供复制或全屏控件。紧凑可搜索列表打开独立详情视图并渲染 Markdown 指令。个人导入还支持移除。令牌连接表单打开时聚焦名称字段，使其在可滚动的设置面板中可见。已配置提供方的登录为主要操作，在 Electron 中通过系统浏览器打开授权，在 Web 中通过新标签页打开。页面保留继续登录链接，并在用户返回应用或主机因连接变更使技能目录失效时刷新账户状态。较早的列表响应不能覆盖较新的刷新结果。连接器列表使用品牌图标并展示连接和启用状态。每项可打开详情视图，查看连接控制及已安装的技能。详情不显示目录标题；圆形返回控件位于设置页眉。禁用连接会保留其凭据。连接器展示 GitHub、Gmail、Google 云端硬盘、Google 日历、Microsoft 365 和自定义 MCP 连接，并提供账户所属的管理操作。

## Table of Contents

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

插件贡献两个 settings.section 条目，使用 locale 所属的英文和中文文案。浏览器回调使用 accountIntegrations Remote；页面不接受账户 ID 或已保存秘密。技能库涵盖整个账户，且不读取对话状态。预设和文件系统条目显示可用状态；个人导入提供启用开关。页面在打开、成功更改后及窗口重新获得焦点时重新加载。此页面直接展示权威 Remote 快照且没有第二套注册表，因此不发布 invariant 伴随插件。

</details>

## Model Experience

None, as 这些页面仅通过主机 Remote 管理集成。

## Known Limitations and Deferred Work

- 在打开的链接中完成提供方授权，再返回 Aeven 显示已保存的连接。
- 已保存的授权状态不会持续监测服务器可达性。

## Dev Note

主机包负责存储、凭据处理及对话工具 scope。
