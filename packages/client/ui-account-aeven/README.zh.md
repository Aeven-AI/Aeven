---
description: "Web 客户端常驻导航条中已登录 Aeven 读者的头像与账户菜单：他们的图片或首字母、通往 Aeven 账户页的链接、夜间模式与登出。"
kind: "package-reference"
---

# @aeven/client-ui-account-aeven

[English](README.md) | 中文

## 概述

`avn-client-ui-account-aeven` 把已登录读者的头像放进 Web 客户端的常驻导航条，并从中打开账户菜单，使读者能看到自己以何身份登录、访问 Aeven 账户页、切换夜间模式并登出。该导航条属于会话列而非某个会话，因此无论是否打开会话——包括冷启动的 hero 界面——头像都在那里：是否有人登录是应用层面的事实，而全新部署正是从该 hero 界面开始的。它展示 Aeven authority 已经恢复的那个读者，自身不向 Aeven 请求任何内容，因此不产生自己的请求开销。无人登录时没有读者可展示，该座位保持为空。请与 Host authority 一同启用；单独启用时它不渲染任何内容。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与推迟事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在同时挂载 Aeven authority 的 Web 组合中挂载这一行，会话列的导航条便会出现一个可打开账户菜单的头像——无论是否打开会话。

### 何时选择它

当部署以 Aeven 认证读者、并希望他们看到并管理该会话时选择它。没有 authority 就没有读者，该行不渲染任何内容——请与 `identity-user-aeven` 一同启用或停用，而不是单独操作。

### 最小配置

该行不接受任何配置；它是一个 host 侧为空的浏览器插件：

```yaml
- id: ui-account-aeven
  name: '@aeven/client-ui-account-aeven'
```

浏览器侧注入 `slots`、`locale` 与 `theme`，因此缺少其中任何一个的组合会让该行处于等待而非已挂载状态。

### 菜单提供什么

头像展示读者上传的图片；若未设置，则展示带其首字母的生成渐变。菜单包含夜间模式开关与登出。仅当部署通过 `webUrl` 指明了 web 客户端时，它才链接到 Aeven 账户页：无法指明该页面的 harness 不会杜撰一个，因此该项直接不存在。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节讲该菜单如何接线；可观察行为见[使用本包](#use-this-package)。

### 不导入 gate 也能读取读者

认证 gate 被静态链接进 boot kernel，而任何插件 bundle 都无法导入它。因此 gate 把读者以全局变量形式声明在页面上，本插件从那里读取，方式与 Host 声明 Aeven 端点相同。于是该插件不持有任何会话逻辑，也不发起 Aeven 调用：登出是 gate 与读者一并声明的一个函数。

### 空的 host 侧

该功能只存在于浏览器中，但仅限浏览器的行仍必须可从 host 持有的 Loader overlay 寻址。因此 node 侧是一个空的 `apply`，而 `avn.client` 清单段携带名册条目、其 injects 与 `web` 平台。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 让仅限浏览器的行保持可寻址的空 host 侧 |
| [`src/client/index.ts`](src/client/index.ts) | 读取已声明的读者、注册 locale 并占据导航条座位 |
| [`src/client/AccountMenu.tsx`](src/client/AccountMenu.tsx) | 菜单：账户链接、夜间模式、登出 |
| [`src/client/Avatar.tsx`](src/client/Avatar.tsx) | 上传的图片，或生成的渐变与首字母 |
| [`src/client/locales.ts`](src/client/locales.ts) | `account.aeven` locale 命名空间及其键 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当仅有该菜单还不够时阅读这些：建立会话的界面、校验它的 authority，以及为头像安排座位的 slot 系统。

- [avn-client-ui-auth-aeven](../ui-auth-aeven/README.zh.md)——声明本菜单所展示读者的登录界面。
- [avn-identity-user-aeven](../../identity/user-aeven/README.zh.md)——Host authority，以及决定账户链接是否出现的 `webUrl`。
- [avn-client-ui-slots](../ui-slots/README.zh.md)——为头像提供导航条座位的 slot 映射。
- [client 组映射](../README.zh.md)——本包所属的浏览器家族。

-----

<a id="model-experience"></a>
## 模型体验

None, as the account menu is browser-side UI that registers nothing model-facing.

#### KV Cache effect

无；本包既不组装也不发送提供方请求。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

以下是该菜单的当前约束，不是任务积压。

- **账户链接需要已配置的 web 客户端**——没有 `webUrl` 时部署无法指明账户页，因此菜单不提供该项，而不是猜一个出来。
- **读者只从页面读取一次**——菜单反映 gate 在启动时恢复的会话。在同一页面生命期内于 Aeven 客户端修改的资料，要到下次文档加载才会被采纳。
- **按设计与 Aeven 绑定**——该行专门读取 Aeven 读者全局变量，因此换一个 authority 需要自己的账户行，而不是复用这一个。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**Runtime invariant:** No companion is published. The row owns no durable state; the reader it draws is owned by the authentication gate, and locale and seat registration are covered by the package's own tests.
