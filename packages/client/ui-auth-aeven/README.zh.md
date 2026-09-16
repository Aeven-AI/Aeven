---
description: "DSH web 客户端的 Aeven 登录、注册与 OAuth 结果界面，以及 boot kernel 在插件图存在之前调用的会话恢复、bearer 刷新与已认证传输辅助函数。"
kind: "package-library"
---

# @aeven/client-ui-auth-aeven

[English](README.md) | 中文

## 概述

`dsh-client-ui-auth-aeven` 为 DSH web 壳提供 Aeven 认证界面：它恢复既有的 Aeven 会话，在没有会话时展示登录、注册与 OAuth 结果界面，并在之后把 Aeven bearer 附加到每次 DSH RPC 调用上。web boot kernel 在任何插件运行之前直接调用它，因此读者要么到达已认证的应用，要么到达登录界面，绝不会停在半启动状态。在 Aeven 客户端中开始的会话在此可被理解，反之亦然，因为两者使用相同的存储键与相同的 `appBearers` 结构。本包中没有任何面向模型的内容。

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

### 何时使用它

这是一个库而非插件：认证 gate 在插件图存在之前运行，因此它的代码无法经由投递插件的模块系统抵达。它被静态链接进 [`dsh-client-web`](../web/README.zh.md)，那是它唯一的调用方。当你要改动 web 壳的启动序列时使用它；仅需知道谁已登录的功能应改为读取已声明的读者，而不是导入本包，因为插件 bundle 无法触及它。

### 入口点

boot kernel 以会话恢复为闸门，在无人登录时把容器交给界面：

```text
import { restoreSession, mountAuthScreen, requireSignIn, installAuthenticatedTransport } from '@aeven/client-ui-auth-aeven'

const result = await restoreSession()
if (result.state === 'authenticated') installAuthenticatedTransport()
else if (result.state === 'unauthenticated') { requireSignIn(location.pathname); mountAuthScreen(container, location.pathname) }
```

`restoreSession` 回答 `authenticated`、`unauthenticated` 或 `disabled`。`disabled` 表示所服务的页面中未配置 Aeven API，此时壳的启动与不存在任何 authority 时相同。成功会把读者声明在页面上，插件 bundle 随后据此读取。

Aeven 无法抵达时，`restoreSession` 会用它所保留的最近一份 profile 回答 `authenticated`，而不是把读者登出。Host 用自己持有的签名密钥副本来校验有效期一年的 refresh cookie，因此在 Aeven 不可用期间仍能识别读者，应用也能继续抵达读者自行配置的模型与 OAuth 提供方。只有 Aeven 明确拒绝该凭据，或读者登出，才会结束会话。

### 界面成功后做什么

界面通过离开认证界面来报告成功——前往读者最初请求的路径，该路径记在 `authReferrer` 中。离开该界面会触发一次文档加载，gate 再次运行并恢复刚刚建立的会话。没有任何东西就地交还控制权，因为 boot 在判定没有会话时便已返回。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节讲该界面如何组装；可观察行为见[使用本包](#use-this-package)。

### 移植的界面配上外部供给的服务层

这些界面按原样从 Aeven 客户端移植过来，因此它们所依赖的 service 对象由此处的若干小型本地模块组装，而不是从标记中改写掉。这让两个客户端的登录行为保持一致，并把移植限制在一道 seam 上。React 仅为此目的被提前引入，因为这些界面必须先于通常提供 React 的 UI renderer 出现在屏幕上。

### 两种凭据，两种传输

refresh token 是此处无法读取的 httpOnly cookie；由 API 把它换成新的 access token。每次已认证调用都经过 `currentBearer`，当持有的 token 未过期且指向正确用户时直接返回它，否则刷新。由于浏览器无法在 WebSocket 升级上设置 header，socket 出示 cookie 而 HTTP 出示 bearer——通过 connection 插件本就读取的传输钩子安装，而不是让该插件了解 Aeven。

### 串行化的刷新

API 每次交换都会轮换 refresh token，拒绝被替换的旧 token，并在拒绝时清除两个 cookie。因此两次出示同一 cookie 的交换会结束会话。同一标签页内的调用方共享一次进行中的续期，同一 origin 各标签页之间的续期在 `aeven-session-refresh` Web Lock 下运行；持锁后会重新读取已存储的 token，从而采用另一个标签页刚完成的续期。纯 HTTP 部署没有 Web Locks，只在每个标签页内部串行化。

### 启动后的会话生命周期

`installAuthenticatedTransport` 还会在 access token 过期前不久续期，并在页面重新可见或网络恢复时再次续期；每次续期都会轮换有效期一年的 refresh token，因此打开的页面保持登录。Host 返回 401 时会续期 bearer 并重试该调用一次。当 API 以 400 或 401 拒绝续期，或另一个标签页的登出移除了已存储的 bearer 时，页面删除持有的 bearer，把当前路径记入 `authReferrer`，并加载登录界面。传输失败或 5xx 不影响会话，稍后重试。

Aeven 无法抵达期间，access token 会过期而没有续期能替换它，因此调用会在不带 `Authorization` header 的情况下发出，Host 仅凭 refresh cookie 完成认证。请求会继续成功，Aeven 恢复后的第一次续期就会恢复 bearer。

### 保留的 profile

每份 `/get-profile` 回答都保存在 `aevenProfile` 下，无法抵达 Aeven 的启动会据此恢复读者，因此账户菜单会显示读者的姓名与头像，而不是一个无名用户。登出会连同 bearer 一起丢弃它；无法解析的条目，或未指明任何人的条目，都按不存在处理，读者需要登录。

### 跟随页面自身的 loopback 主机

当配置的 origin 与页面都是 loopback 时，配置的 `localhost` origin 会被改写为页面自身的主机名。对浏览器而言 `localhost` 与 `127.0.0.1` 是不同站点，因此 API 在其中一个下设置的 cookie 绝不会在另一个下被送回。配置为非 loopback 的主机是部署的刻意选择，不作改动。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | gate：`restoreSession`、`requireSignIn` 与 `installAuthenticatedTransport` |
| [`src/client/auth/mount.tsx`](src/client/auth/mount.tsx) | 挂载界面、跟随界面内导航，以及成功后的交接 |
| [`src/client/auth/services/tokens.ts`](src/client/auth/services/tokens.ts) | 持有的 bearer、可用性检查与串行化的刷新交换 |
| [`src/client/auth/services/watch.ts`](src/client/auth/services/watch.ts) | 后台续期，以及会话结束时前往登录界面 |
| [`src/client/auth/services/errors.ts`](src/client/auth/services/errors.ts) | `AevenApiError` 与会话拒绝的判定 |
| [`src/client/auth/services/api.ts`](src/client/auth/services/api.ts) | 界面调用的 Aeven 认证路由 |
| [`src/client/auth/services/config.ts`](src/client/auth/services/config.ts) | 读取注入的端点以及跟随 loopback 的规则 |
| [`src/client/auth/services/reader.ts`](src/client/auth/services/reader.ts) | 把恢复的读者声明在页面上供插件 bundle 使用 |
| [`src/client/locales.ts`](src/client/locales.ts) | `auth.aeven` 字典，以及界面据以读取文案的浏览器语言查找 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当仅有该界面还不够时阅读这些：调用它的壳、校验它所建立内容的 authority，以及展示结果的菜单。

- [dsh-client-web](../web/README.zh.md)——在插件图之前以本库为闸门的 boot kernel。
- [dsh-identity-user-aeven](../../identity/user-aeven/README.zh.md)——校验凭据并声明本库所读端点的 Host authority。
- [dsh-client-ui-account-aeven](../ui-account-aeven/README.zh.md)——读取本库所声明读者的账户菜单。
- [client 组映射](../README.zh.md)——本包所属的浏览器家族。

-----

<a id="model-experience"></a>
## 模型体验

None, as the authentication surface is browser-side UI and transport wiring that registers nothing model-facing.

#### KV Cache effect

无；本包既不组装也不发送提供方请求。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

以下是该界面的当前约束，不是任务积压。

- **登录需要一次文档加载**——界面通过导航来报告成功，gate 在新文档上重新运行。就地把控制权交给应用，需要 boot 在界面占据页面期间保持挂起。
- **该界面只能依据浏览器选择语言**——显式的 locale 偏好保存在 Host 用户设置中，只有已登录的读者才有，因此登录界面无法遵循它。若读者所选语言与浏览器语言不同，登录界面会以浏览器语言显示。
- **存储失败会降级为无会话页面**——隐私模式与被拦截的站点数据会让 bearer 存储不可读，这会表现为没有会话。页面仍可工作；读者重新登录即可。
- **同一时间只支持一个 Aeven 账号**——页面会话是模块级单例，与移植界面的预期一致。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**Runtime invariant:** No companion is published. The library owns browser-local session state with no independently observable relationship; restore, refresh, and route matching are covered by the package's own tests.
