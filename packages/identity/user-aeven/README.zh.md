---
description: "已认证用户 seam 的 Aeven authority：用 API 公布的公钥在本地校验 Aeven access bearer 与 refresh cookie，并在所服务的页面中声明 Aeven 端点。"
kind: "package-reference"
---

# @aeven/identity-user-aeven

[English](README.md) | 中文

## 概述

`avn-identity-user-aeven` 让 Aeven 账号成为 AVN 部署所认证的凭据，因此已登录 Aeven 的读者无需二次登录即可在此登录。它校验 Aeven 客户端出示的两种凭据——HTTP 调用上的 access bearer 与 WebSocket 升级上的 `refreshToken` cookie——用 API 在 `/.well-known/jwks.json` 公布的 ES256 公钥在本地完成，因此识别调用方无需向 Aeven 发出请求，且本 Host 不持有任何能签发 token 的内容。挂载它会让请求围栏改为要求会话而非启动 token，这是运营 Aeven API 的部署刻意做出的决定。它还在所服务的页面中声明 Aeven 端点，这正是浏览器获得登录界面的方式。

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

在 seam 之后挂载它，将 `apiUrl` 指向 Aeven API，Web 界面便会向没有会话的人展示 Aeven 的登录界面。

### 何时选择它

当 AVN 与 Aeven API 一同运营，且读者应以 Aeven 账号访问 AVN 时选择它。Host 启动时会获取 API 的公钥，因此 Host 必须能访问该 API。不运行 Aeven API 的部署不得挂载这一行：存在 authority 而 API 不可达时，每个 `/api` 路由都回答 401，任何读者都无法登录。

### 最小配置

该行注入 seam，并指明用于校验的 API：

```yaml
- id: identity-user-aeven
  name: '@aeven/identity-user-aeven'
  inject: [identityUsers]
  config:
    apiUrl: 'http://localhost:9000'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `id` | `aeven` | 该 seam 下的注册表键 |
| `jwksRefreshIntervalMs` | 60000 | 两次获取 `<apiUrl>/.well-known/jwks.json` 之间的最短间隔 |
| `jwksTimeoutMs` | 10000 | 单次获取密钥集的时限 |
| `refreshCookieName` | `refreshToken` | WebSocket 升级上携带 refresh token 的 cookie |
| `apiUrl` | 无 | 浏览器据以登录的 Aeven API origin；缺失时客户端没有任何认证界面 |
| `webUrl` | 无 | 账户菜单链接到的 Aeven web 客户端 origin |
| `mediaUrl` | 无 | 提供已上传媒体的 origin，头像路径相对于它 |
| `xOAuthUrl`、`appleOAuthUrl`、`googleOAuthUrl` | 无 | 各提供方的登录 URL；缺失某个会隐藏该提供方的按钮 |
| `oauthFlow` | 无 | 提供方登录如何抵达提供方，配置了任一提供方 URL 时必须声明：`redirect` 让读者的文档前往提供方，`window` 从独立窗口抵达。配置了提供方却未声明时，插件拒绝加载 |

生成的[配置目录](../../../docs/config-catalog.zh.md#aevenidentity-user-aeven)是所有可接受字段的详尽来源。

<a id="provider-sign-in-flow"></a>
### 声明提供方登录所走的形式

抵达提供方，要么让读者的文档跳转过去，要么从一个独立窗口过去，而页面无法自行分辨部署要哪一种。公开部署声明 `redirect`：提供方注册就是按这种形式书写的，浏览器对 `window` 施加的弹窗拦截也不是它需要考虑的风险。若应用从自定义 scheme 或 loopback origin 提供自己的页面，则声明 `window`，因为在那种部署里，被跳转的文档意味着再启动一个外壳。

该形式恰好在配置了提供方 URL 时成为必填。不提供任何提供方的部署不声明它；声明了却没有提供方可描述时，它被忽略而非拒绝。

### 让 AVN 与 API 处于同一站点

WebSocket 升级不携带 header，因此只能凭 cookie 认证，而浏览器只把 cookie 送回设置它的那个站点。`localhost` 与 `127.0.0.1` 指向同一台机器，却是不同站点：把 AVN 放在其中一个而 API 在另一个上作答，会让读者通过 HTTP 登录成功，随后 socket 被拒绝。浏览器端配置会跟随页面自身的 loopback 主机，使无论键入哪个地址两者都处于同一站点。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节讲校验与注入如何构建；可观察行为见[使用本包](#use-this-package)。

### 两种凭据，一个 resolver

resolver 先读 bearer：HTTP 调用携带 access token，它是两者中存活更短、且由客户端保持新鲜的那个。随后回退到 cookie，那是 WebSocket 升级唯一能出示的凭据。两者都是同一密钥下的 ES256 token；`typ` claim（`access` 或 `refresh`）防止一种冒充另一种，对应 Aeven API 自身的 `authenticate` 与 `authenticateSocketUpgrade`。在密钥集加载之前或未配置 `apiUrl` 时，任何 token 都不会校验通过。

### 为什么在本地校验

seam 同步解析，因此 authority 无法调用 Aeven。它改为用内存中 API 的公钥检查签名，这让识别调用方无需发出站请求。token 若指明 Host 尚未持有的密钥 id，会触发后台重新获取（受 `jwksRefreshIntervalMs` 限速），因此轮换后的密钥从调用方的下一次请求起即可校验。代价是一个吊销窗口：在过期前被吊销的 token 在此仍会校验通过，直到它过期。登出会在源头使凭据失效，这正是该窗口在实践中很窄的原因。

### 在页面中声明端点

Aeven 的各 origin 是部署事实而非构建事实，因此由 Host 声明，而不是让浏览器 bundle 携带。该插件把 `__AVN_AEVEN__` 全局推入 `webserver/index-inject` 表；浏览器认证库读取它，并把缺失的 `apiUrl` 视为"未配置 Aeven authority"，这正是不含这一行的组合的行为。

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

- [avn-identity-user](../user/README.zh.md)——本包实现的 seam 与 resolver 契约。
- [avn-client-ui-auth-aeven](../../client/ui-auth-aeven/README.zh.md)——登录界面，以及本 authority 随后认得的会话。
- [avn-client-ui-account-aeven](../../client/ui-account-aeven/README.zh.md)——展示本 authority 所恢复读者的账户菜单。
- [avn-client-connection](../../client/connection/README.zh.md)——一旦挂载 authority 便不再使用启动 token 的围栏。
- [生成的配置目录](../../../docs/config-catalog.zh.md#aevenidentity-user-aeven)——每个可接受的配置字段及其源声明。

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
- **AVN 与 API 必须共享站点**——cookie 路径要求同一站点，且 Host 必须能访问 API 以加载其公钥。本 authority 适用于 AVN 与 Aeven 一同运营，而非第三方对接公开的 Aeven。
- **挂载它会为整个界面设围栏**——没有按路由的豁免。没有可达 Aeven API 的部署应移除该行，而不是期待降级模式。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**Runtime invariant:** No companion is published. The authority owns no durable state; resolver registration, token verification, and index injection are covered by the package's own tests.
