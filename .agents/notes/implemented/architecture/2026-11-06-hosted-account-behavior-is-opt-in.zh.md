# Agent Note: 服务多人的 Host 显式启用按账户行为；桌面端保持默认

Status: implemented

[English](2026-11-06-hosted-account-behavior-is-opt-in.md) | 中文

## 问题

托管配置（`@aeven/hosted-app`）在一个 Host 上服务不同人的账户，因此主题、听写、引导、提供商路由以及 Grok Build 和 Codex 订阅在那里必须属于各自的账户。最初为此所做的改动修改了桌面应用同样加载的共享注册与默认值：

- 主题、speech-to-text、引导和 `llm-pi-ai` 以 `reach: 'account'` 注册，于是 `@aeven/settings-sync` 开始在桌面端的各设备之间复制它们。
- `sync-yjs` 默认在新设备的每次追赶之前先获取七个文档。
- 工作区注册表把另一台设备发布的无目录工作区作为自己的工作区导入，而不是作为那台设备的工作区。

## 决定

按账户行为是只有托管 bundle 才会设置的显式配置；所有默认值都保持桌面端行为。

- `SettingsRegisterOptions.perAccount`（以及 `SettingsSectionHooks.perAccount`）只在 `accountSections` 开启的提供者上（`settings-file` `accounts: true`）以 `account` reach 注册命名空间；其他提供者按其声明的 `reach` 注册。主题保持 `device`，其余保持默认的 `device`。
- `sync-yjs` `firstDocuments` 默认为空；托管补丁列出浏览器打开时所需的文档。
- `@aeven/workspace` `pathlessWorkspaces` 默认为 false；托管补丁将其开启。
- 按账户订阅只在 `avn-subscription-auth` `accounts: true` 时运行（`src/accounts.ts`）：每个账户的凭据、模型列表和选择保存在 `accounts/<account>/subscriptions/` 下，路由回答请求所携带的账户，修改类请求必须来自本 Host 的页面。未开启时，所有者路由和 `~/.grok` 登录照旧运行。

## 考虑过的替代方案

在所有地方都让这些命名空间保持 `account` reach。已否决：在桌面端，这会改变主题、听写选择或提供商路由属于哪台设备，而且配置的提供商端点会跟随账户到达无法访问它的设备。

让托管设置提供者在其配置中列出按账户的命名空间。已否决：拥有该部分的插件知道它是否是个人的选择；提供者只知道自己是否保存账户部分。

## 后果

从此代码树构建的桌面应用的注册、同步和导入与之前完全相同。托管补丁是唯一开启按账户行为的地方，因此新的仅托管行为需要一个默认关闭的选项和一行补丁。
