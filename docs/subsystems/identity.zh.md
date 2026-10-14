# 已认证用户身份

[English](identity.md) | 中文

已认证用户 seam——建立在单一 `ctx.identityUsers` 服务上的[能力 seam](../glossary.zh.md#capability-seam)：Service Definition（[avn-identity-user](../../packages/identity/user)，resolver 注册表）、Service Provider（懂得真实凭据的 authority），以及作为 Consumer 的请求围栏。每个需要知道当前是谁在操作的子系统都读取这一个服务，从不接触 cookie、bearer token 或过期时间。身份是**一项可选能力**：没有注册任何 authority 时，该服务不认得任何人，原装 harness 保持单用户且未认证。

来源：[`packages/identity/user/src/types.ts`](../../packages/identity/user/src/types.ts)

## authority 拿到什么

authority 只收到 header，别无其他，因为 header 是两种 AVN 传输的共同点。HTTP 请求在 `authorization` 中携带凭据。浏览器无法在 WebSocket 升级上设置 header，因此 Remote stream Client 把 bearer 作为子协议提供，gateway 再以 `authorization` 交给该 seam；不带 bearer 的升级只携带 `cookie`。这里不为 authority 解码任何内容——它读取自己认得的那个 header。

`User` 只保证 `id`。那是子系统据以关联工作的字段，也是 authority 必须能产出的唯一字段；`email`、`displayName` 与 `avatarUrl` 是 authority 可能持有也可能不持有的展示信息，因此需要显示名的消费方应处理其缺失，而不是假定已经拉取过资料。

## 解析是同步的

`resolve` 按契约是同步的。AVN 在已经为每个 HTTP 请求和每次 WebSocket 升级运行的请求围栏内部调用该 seam，而这道围栏在派发之前作答。需要调用网络服务的 authority 无法在那里被调用，因此 authority 改为在本地校验。这正是识别调用方无需发出站请求的原因，也是塑造每个 authority 的约束：代价是一个吊销窗口，因为在过期前被吊销的凭据仍会校验通过，直到它过期。

## 首个命中者胜出

`resolve` 按注册顺序遍历已注册的 authority，返回其中第一个认得的用户。组合完全通过挂载它们的顺序来控制优先级；没有任何东西为 authority 排序，因为若某部署的两个 authority 对同一凭据存在分歧，那属于组合问题而非解析问题。用同一个 id 注册两个 authority 会抛错，而不是静默替换。

## 失败不携带原因

authority 报告 `User` 或 `undefined`——从不说明原因。两种情况下 AVN 都回答 401，而说明原因等于把凭据的情况描述给提交它的人。因此消费方只需处理一种情况，而不是三种。

## 挂载 authority 会改变什么

`enforcing` 报告是否注册了任何 authority，请求围栏会读取它。一个都没有时，围栏保持既有行为，仍由启动 token 决定哪个浏览器可以与该进程通话。有一个时，启动 token 被取代：该 token 并不比登录界面多授予任何东西，而打印它会诱使读者把 URL 当作凭据。Host/Origin 围栏仍然始终运行——它回答该进程是否愿意与调用方的页面通话，这一点任何认证都无法取代。

一旦挂载 authority，所服务的 index 对任何人都保持可读。它不携带数据，而且正是它呈现登录界面；拒绝它会让读者无从登录。它背后的每个 API 路由都要求会话。


<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxidentityusers--identityusers"></a>

### `ctx.identityUsers` — `IdentityUsers`

Registry of authorities, and the resolution every consumer goes through.

```ts cordis-catalog
/**
 * Register one authority.
 * @param resolver - the authority to add.
 * @returns the disposer removing it.
 */
registerResolver(resolver: UserResolver): () => void

/**
 * Identify the caller through the registered authorities.
 *
 * The first authority that recognizes the credential answers. Order is
 * registration order, which a composition controls by the order it mounts
 * them; nothing here ranks authorities, because a deployment with two that
 * disagree about one credential has a composition problem, not a resolution
 * problem.
 * @param request - the credential-bearing headers.
 * @returns the authenticated user, or undefined when none recognized it.
 */
resolve(request: IdentityRequest): User | undefined

/**
 * The credential reference the resolver that recognizes this request named.
 *
 * Answers which reference the presented credential opens, so a caller that
 * must present the same credential elsewhere does not have to guess a name
 * from the authority's id. Resolution happens exactly once per request, which
 * is why this identifies rather than asking the authority again.
 * @param request - the credential-bearing headers.
 * @returns the reference, or undefined when nobody recognized the request or
 * the authority declared none.
 */
credentialRefFor(request: IdentityRequest): CredentialRef | undefined
```

Types: [CredentialRef](credentials.zh.md)

Source: [`packages/identity/user/src/index.ts`](../../packages/identity/user/src/index.ts)
<!-- END GENERATED cordis-surface -->

## 包

| 包 | 职责 |
|---|---|
| [avn-identity-user](../../packages/identity/user/README.zh.md) | Service Definition：resolver 注册表、`enforcing` 与首个命中的 `resolve` |
| [avn-identity-user-aeven](../../packages/identity/user-aeven/README.zh.md) | Service Provider：用 API 自身的签名密钥校验 Aeven access bearer 与 refresh cookie |
| [avn-client-ui-auth-aeven](../../packages/client/ui-auth-aeven/README.zh.md) | 建立会话的浏览器界面，authority 随后认得该会话 |
| [avn-client-ui-account-aeven](../../packages/client/ui-account-aeven/README.zh.md) | 展示 authority 所恢复读者的账户菜单 |

## 相关

- [HTTP 服务器](web-server.zh.md)——其请求围栏调用本 seam 的服务器。
- [Web Client 架构](web-client.zh.md)——其启动在插件图之前以会话恢复为闸门的壳。
- [用户凭据](credentials.zh.md)——无关的出站 seam：AVN 向提供方出示的密钥，而非 AVN 识别的调用方。
