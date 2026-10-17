---
description: "Web 客户端常驻导航条中已登录 Aeven 读者的头像与账户菜单：他们的图片或首字母、应用设置与登出。"
kind: "package-reference"
---

# @aeven/client-ui-account-aeven

[English](README.md) | 中文

## 概述

`avn-client-ui-account-aeven` 把已登录读者的头像放进 Web 客户端的常驻导航条，并从中打开账户菜单，使读者能看到自己以何身份登录、处于哪个方案、前往自己的账户页并登出。该导航条属于会话列而非某个会话，因此无论是否打开会话——包括冷启动的 hero 界面——头像都在那里：是否有人登录是应用层面的事实，而全新部署正是从该 hero 界面开始的。它展示 Aeven authority 已经恢复的那个读者，并自行发起一次调用：菜单所写的方案，在页面绘制出已登录读者的那一刻就从账户的订阅路由读取。无人登录时没有读者可展示，该座位保持为空。请与 Host authority 一同启用；单独启用时它不渲染任何内容。

账号设置同时掌管读者的图片：照片控件打开选择器并保存读者选中的文件，已有图片时其旁出现删除控件，用于清除图片使头像回到首字母；点击图片本身同样会打开选择器。两者都经由已发布的读者完成，该读者会重新声明自身，因此下一次绘制读者的地方都会看到已存储的图片，而不是页面启动时的那张。

账号 → 安全提供双重验证开关。启用时会打开二维码设置流程，并要求输入身份验证器验证码后才生效；恢复码仅显示一次。关闭时需要输入身份验证器验证码或未使用的恢复码。开关显示已确认的保护状态；取消操作或验证码被拒绝时保持不变。无法获取状态时，开关不可用并提供重试选项。这些控件位于账号设置内。页面通过已发布用户的认证 `mfa` 方法调用这些操作。

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

浏览器侧注入 `slots` 与 `locale`，因此缺少其中任何一个的组合会让该行处于等待而非已挂载状态。

### 菜单提供什么

头像展示读者上传的图片；若未设置，则展示带其首字母的生成渐变。打开菜单会显示读者与账户所在的方案：页面一绘制出已登录读者，就即刻从账户的订阅路由读取该方案，因此面板在打开的那一帧就写出它，而不是稍后才出现；答案在后续打开时沿用。若某次打开时仍无方案，则会再次询问。图片与名字构成同一行，点击会关闭菜单并以 `account` 发出 `settings/open`，让读者落到自己的页面。其下依次是设置行，发出 `settings/open` 打开设置外壳的着陆页，以及登出。主题选择位于外观设置中，该设置也提供跟随系统。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节讲该菜单如何接线；可观察行为见[使用本包](#use-this-package)。

### 不导入 gate 也能读取读者

认证 gate 被静态链接进 boot kernel，而任何插件 bundle 都无法导入它。因此 gate 把读者以全局变量形式声明在页面上，本插件从那里读取，方式与 Host 声明 Aeven 端点相同。于是该插件不持有任何会话逻辑：登出是 gate 与读者一并声明的一个函数，而菜单唯一发起的 Aeven 调用是方案读取，经由该读者带认证的 `cloud` 方法完成。

### 空的 host 侧

该功能只存在于浏览器中，但仅限浏览器的行仍必须可从 host 持有的 Loader overlay 寻址。因此 node 侧是一个空的 `apply`，而 `avn.client` 清单段携带名册条目、其 injects 与 `web` 平台。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 让仅限浏览器的行保持可寻址的空 host 侧 |
| [`src/client/index.ts`](src/client/index.ts) | 读取已声明的读者、注册 locale 并占据导航条座位 |
| [`src/client/AccountMenu.tsx`](src/client/AccountMenu.tsx) | 菜单：读者与方案、其账户页、设置、登出 |
| [`src/client/AccountSection.tsx`](src/client/AccountSection.tsx) | 账号页：读者的图片、方案、额度、用量与安全 |
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
- **方案每个页面只读取一次**——菜单持有页面绘制读者时读到的方案，因此在账户页或另一客户端做出的方案变更，要到下次文档加载后才在此出现。读取失败时该页面将缺少这一行，直到某次打开再次询问。
- **常驻头像在下次渲染时更新**——读者在启动时以及每次图片变更后声明在页面上，但它不是订阅：导航条中的头像会在下一次渲染时显示新图片，打开菜单或离开设置都会触发这次渲染。
- **正方形图片**——API 会把上传内容重新编码为配置尺寸的正方形 WebP，因此非正方形图片会被裁剪而非留边，动画图片只保留第一帧。
- **按设计与 Aeven 绑定**——该行专门读取 Aeven 读者全局变量，因此换一个 authority 需要自己的账户行，而不是复用这一个。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**Runtime invariant:** No companion is published. The row owns no durable state; the reader it draws is owned by the authentication gate, and locale and seat registration are covered by the package's own tests.
