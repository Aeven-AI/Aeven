---
description: "已认证用户 seam：ctx.identityUsers，每个 AVN 子系统据此了解当前是谁在操作，以及 authority 包注册进入的 resolver 契约。"
kind: "package-reference"
---

# @aeven/identity-user

[English](README.md) | 中文

## 概述

`avn-identity-user` 让一套组合有唯一的地方回答"是谁发起了这个请求"，因此需要操作者身份的子系统读取 `ctx.identityUsers`，而不必了解 cookie、bearer token 或过期时间。挂载它，然后挂载一个懂得真实凭据的 authority 包；没有 authority 时该服务不认得任何人，请求围栏保持既有行为，因此原装 harness 仍是单用户且未认证的。解析按契约是同步的，因为 AVN 在派发之前作答的那道围栏内部调用它。该服务不注册任何面向模型的内容。

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

挂载这一行，在旁边挂载一个 authority，于是每个需要操作者身份的消费方都读取同一个服务。

### 何时选择它

当部署必须知道谁在操作时挂载它——用于给请求设围栏、归属工作量，或展示已登录的读者。单独挂载它不会带来可观察的变化：seam 是注册表，凭据知识由 authority 包提供。单用户的本地 harness 两行都不需要。

### 最小配置

该行不接受任何配置；authority 在它之后挂载并注入该服务：

```yaml
- id: identity-user
  name: '@aeven/identity-user'

- id: identity-user-aeven
  name: '@aeven/identity-user-aeven'
  inject: [identityUsers]
```

该服务暴露三个成员：`registerResolver(resolver)` 添加一个 authority 并返回移除它的 disposer，`enforcing` 报告是否注册了任何 authority，`resolve(request)` 从携带凭据的 header 中识别调用方。

### 解析回答了什么

`resolve` 按注册顺序把请求交给每个已注册的 authority，返回其中第一个认得的用户；都不认得时返回 `undefined`。组合完全通过挂载 authority 的顺序来控制优先级。凭据失败的原因刻意不上报——两种情况下 AVN 都回答 401，而说明原因等于把凭据的情况描述给提交它的人。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节讲注册表如何构建；可观察行为见[使用本包](#use-this-package)。

### 设计理念

该 seam 刻意做得很薄：一个从 authority id 到 resolver 的 `Map`，加上一次首个命中的遍历。它自身不持有任何凭据知识，因此新增 authority 从不需要改动本包。注册重复 id 会抛错而非静默替换，因为同一名称下有两个 authority 属于组合错误，否则会以无法解释的解析结果表现出来。

### 为什么解析是同步的

AVN 在已经为每个 HTTP 请求和每次 WebSocket 升级运行的请求围栏内部调用该 seam，而这道围栏在派发之前作答。需要访问网络服务的 resolver 无法在那里被调用，因此契约禁止这样做：authority 在本地验证，这正是识别调用方无需发出站请求的原因。

### 请求词汇

authority 只拿到 header，因为这是两种 AVN 传输的共同点——HTTP 在 `authorization` 中携带凭据，而 Remote stream gateway 把 WebSocket 提供的 bearer 子协议作为同一 header 交出，因为浏览器无法在升级上设置 header；未提供 bearer 的升级只携带 `cookie`。这里不为 authority 解码任何内容；它读取自己认得的那个 header。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `IdentityUsers` 服务：resolver 注册表、`enforcing` 与首个命中的 `resolve` |
| [`src/types.ts`](src/types.ts) | `User`、`IdentityRequest` 以及 authority 实现的 `UserResolver` 契约 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当仅有该 seam 还不够时阅读这些：实现它的 authority、调用它的围栏，以及读者据以登录的浏览器界面。

- [avn-identity-user-aeven](../user-aeven/README.zh.md)——按本契约验证真实凭据的 Aeven authority。
- [avn-client-ui-auth-aeven](../../client/ui-auth-aeven/README.zh.md)——建立会话的浏览器登录界面，authority 随后认得该会话。
- [avn-client-connection](../../client/connection/README.zh.md)——读取本服务并决定 401 的请求围栏。
- [identity 组映射](../README.zh.md)——本包所属的家族。

-----

<a id="model-experience"></a>
## 模型体验

None, as the seam only identifies the caller for host-side consumers and registers no prompt, tool, or result.

#### KV Cache effect

无；本包既不组装也不发送提供方请求。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

以下是该 seam 的当前约束，不是任务积压。

- **authority 必须在本地验证**——`resolve` 按契约是同步的，因此必须调用网络服务才能校验凭据的 authority 无法在此注册。本地验证正是围栏无需发出站请求的原因，代价是在过期之前被吊销的凭据仍会解析成功，直到它过期为止。
- **失败原因不会到达调用方**——resolver 只报告用户或 `undefined`。区分凭据缺失、格式错误与已过期，对消费方刻意不可用。
- **authority 之间没有排序**——优先级只由挂载顺序决定。若某部署的多个 authority 对同一凭据存在分歧，那是 seam 不予裁决的组合问题。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**Runtime invariant:** No companion is published. The registry owns one map with no independently observable relationship; registration and disposal are covered by the package's own tests.
