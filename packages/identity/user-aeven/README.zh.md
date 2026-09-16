---
description: "已认证用户 seam 的 Aeven authority：用 API 自身的签名密钥在本地校验 Aeven access bearer 与 refresh cookie，并在所服务的页面中声明 Aeven 端点。"
kind: "package-reference"
---

# @aeven/identity-user-aeven

[English](README.md) | 中文

## 概述

`dsh-identity-user-aeven` 让 Aeven 账号成为 DSH 部署所认证的凭据，因此已登录 Aeven 的读者无需二次登录即可在此登录。它校验 Aeven 客户端出示的两种凭据——HTTP 调用上的 access bearer 与 WebSocket 升级上的 `refreshToken` cookie——用 API 自身的签名密钥在本地完成，因此识别调用方无需向 Aeven 发出请求。挂载它会让请求围栏改为要求会话而非启动 token，这是运营 Aeven API 的部署刻意做出的决定。它还在所服务的页面中声明 Aeven 端点，这正是浏览器获得登录界面的方式。

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

在 seam 之后挂载它，提供 Aeven API 的两个签名密钥，Web 界面便会向没有会话的人展示 Aeven 的登录界面。

### 何时选择它

当 DSH 与 Aeven API 一同运营，且读者应以 Aeven 账号访问 DSH 时选择它。只有在该前提下本地校验才是可靠的，因为它依赖共享 API 的密钥。不运行 Aeven API 的部署不得挂载这一行：存在 authority 而 API 不可达时，每个 `/api` 路由都回答 401，任何读者都无法登录。

### 最小配置

该行注入 seam，并从环境变量读取密钥：

```yaml
- id: identity-user-aeven
  name: '@aeven/identity-user-aeven'
  inject: [identityUsers]
  config:
    apiUrl: 'http://localhost:9000'
    accessSecretEnv: AEVEN_JWT_SECRET
    refreshSecretEnv: AEVEN_REFRESH_SECRET
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `id` | `aeven` | 该 seam 下的注册表键 |
| `accessSecretEnv` | `AEVEN_JWT_SECRET` | 持有 access token 密钥的环境变量 |
| `refreshSecretEnv` | `AEVEN_REFRESH_SECRET` | 持有 refresh token 密钥的环境变量 |
| `refreshCookieName` | `refreshToken` | WebSocket 升级上携带 refresh token 的 cookie |
| `apiUrl` | 无 | 浏览器据以登录的 Aeven API origin；缺失时客户端没有任何认证界面 |
| `webUrl` | 无 | 账户菜单链接到的 Aeven web 客户端 origin |
| `mediaUrl` | 无 | 提供已上传媒体的 origin，头像路径相对于它 |
| `xOAuthUrl`、`appleOAuthUrl`、`googleOAuthUrl` | 无 | 各提供方的登录 URL；缺失某个会隐藏该提供方的按钮 |

生成的[配置目录](../../../docs/config-catalog.zh.md#aeven-identity-user-aeven)是所有可接受字段的详尽来源。

### 让 DSH 与 API 处于同一站点

WebSocket 升级不携带 header，因此只能凭 cookie 认证，而浏览器只把 cookie 送回设置它的那个站点。`localhost` 与 `127.0.0.1` 指向同一台机器，却是不同站点：把 DSH 放在其中一个而 API 在另一个上作答，会让读者通过 HTTP 登录成功，随后 socket 被拒绝。浏览器端配置会跟随页面自身的 loopback 主机，使无论键入哪个地址两者都处于同一站点。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节讲校验与注入如何构建；可观察行为见[使用本包](#use-this-package)。

### 两种凭据，一个 resolver

resolver 先读 bearer：HTTP 调用携带 access token，它是两者中存活更短、且由客户端保持新鲜的那个。随后回退到 cookie，那是 WebSocket 升级唯一能出示的凭据。两者各用自己的共享密钥校验，对应 Aeven API 自身的 `authenticate` 与 `authenticateSocketUpgrade`。密钥缺失或为空会禁用该路径，而不是接受任意值。

### 为什么在本地校验

seam 同步解析，因此 authority 无法调用 Aeven。它改为用 API 的密钥检查签名，这让识别调用方无需发出站请求。代价是一个吊销窗口：在过期前被吊销的 token 在此仍会校验通过，直到它过期。登出会在源头使凭据失效，这正是该窗口在实践中很窄的原因。

### 在页面中声明端点

Aeven 的各 origin 是部署事实而非构建事实，因此由 Host 声明，而不是让浏览器 bundle 携带。该插件把 `__DSH_AEVEN__` 全局推入 `webserver/index-inject` 表；浏览器认证库读取它，并把缺失的 `apiUrl` 视为"未配置 Aeven authority"，这正是不含这一行的组合的行为。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Config、先 bearer 后 cookie 的 resolver，以及 index 注入监听器 |
| [`src/jwt.ts`](src/jwt.ts) | 产出用户 id 的签名与过期校验 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当仅有 authority 还不够时阅读这些：它注册进入的 seam、建立会话的浏览器界面，以及执行认证的围栏。

- [dsh-identity-user](../user/README.zh.md)——本包实现的 seam 与 resolver 契约。
- [dsh-client-ui-auth-aeven](../../client/ui-auth-aeven/README.zh.md)——登录界面，以及本 authority 随后认得的会话。
- [dsh-client-ui-account-aeven](../../client/ui-account-aeven/README.zh.md)——展示本 authority 所恢复读者的账户菜单。
- [dsh-client-connection](../../client/connection/README.zh.md)——一旦挂载 authority 便不再使用启动 token 的围栏。
- [生成的配置目录](../../../docs/config-catalog.zh.md#aeven-identity-user-aeven)——每个可接受的配置字段及其源声明。

-----

<a id="model-experience"></a>
## 模型体验

None, as the authority only identifies the caller for the request fence and registers no prompt, tool, or result.

#### KV Cache effect

无；本包既不组装也不发送提供方请求。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

以下是该 authority 的当前约束，不是任务积压。

- **过期前被吊销的 token 仍会校验通过**——本地校验无法观察到 API 记录的吊销。该窗口在 token 过期时关闭。
- **DSH 与 API 必须共享站点与密钥**——cookie 路径要求同一站点，本地校验要求 API 自身的 `JWT_SECRET` 与 `REFRESH_SECRET`。本 authority 适用于 DSH 与 Aeven 一同运营，而非第三方对接公开的 Aeven。
- **挂载它会为整个界面设围栏**——没有按路由的豁免。没有可达 Aeven API 的部署应移除该行，而不是期待降级模式。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**Runtime invariant:** No companion is published. The authority owns no durable state; resolver registration, token verification, and index injection are covered by the package's own tests.
