# Agent Note: Aeven 故障时应用继续运行

Status: implemented

[English](2026-09-15-aeven-outage-leaves-the-application-running.md) | 中文

## 问题

在 Aeven API 停止服务时，一次页面加载却呈现登录界面，尽管读者的凭据完好无损，其正在处理的内容也没有任何失败。登录同样不可能：该界面提交到同一个不可达的 API，因此 harness 在 Aeven 恢复之前完全不可用。

`restoreSession`（`packages/client/ui-auth-aeven/src/client/index.ts`）在一个把所有失败一视同仁的 `catch` 中调用 `getProfile`。不可达的 API 会让 `fetch` 以 `TypeError` 拒绝，而它不携带状态码，因此故障与拒绝无从区分，两者都得到 `unauthenticated`。web boot kernel 随后在应用之上挂载了认证界面。

本包的其余部分早已做出这一区分。`isSessionRefusal`（`auth/services/errors.ts`）只接受 400 或 401 的 `AevenApiError`，因此 `auth/services/watch.ts` 中启动后的续期在故障与 5xx 期间正确地保住了会话。只有启动 gate 把两者混为一谈。

## 决策

Aeven 是身份提供方，而不是可用性依赖。本地节点居先：Aeven 无法抵达时，应用照常启动并运行。

`restoreSession` 区分拒绝与不可达。拒绝一如从前地结束会话。其他任何失败都用保存在 `aevenProfile` 下的 profile 恢复读者，并回答 `authenticated`，于是应用照常启动，并继续能够访问读者自己配置的模型与 OAuth 提供方——打包应用存在的意义正是运行这些提供方，而其中没有一个由 Aeven 提供。

Host 无需改动，这正是该方案成立的原因。`identity-user-aeven` 的解析器（`packages/identity/user-aeven/src/index.ts`）先尝试 access bearer，再尝试 `refreshToken` cookie，而 `verifiedUserId` 把两者对照本地节点自身环境中持有的 secret 进行校验。`rpc-host.ts` 的请求围栏放行该解析器识别出的任何身份。因此失效的 bearer 会回落到有效期为一年的 cookie，在本地完成校验，而 `/api` 在 Aeven 停止服务时继续能够回答。部署本就被要求从与 API 相同的站点提供 DSH，因此无论本地节点监听哪个端口，cookie 都能抵达它。

每条 `/get-profile` 回答都保存在 `localStorage` 中，因为 profile 正是账户菜单中为读者命名的依据，而它在故障期间无法读取。`signOut` 会把它连同 bearer 一起丢弃。

## 考虑过的替代方案

**发送已失效的 access token，而不是省略该 header。** 这行不通：`verifiedUserId` 会拒绝过期 token，因此每次调用都会 401，无论如何都会回落到 cookie。省略该 header 能一步抵达同一 authority。

**在 Host 上为最近过期的 bearer 设一段宽限期。** 这为所有调用方削弱了 access token 的过期机制，去解决 refresh cookie 本已解决的问题，而且它还得被配置成与它所预期的故障相匹配。

**把启动停在重试界面上，直到 Aeven 回答。** 这能让读者免于看到一个看起来已损坏的应用，但也让他们无法得到一个可正常工作的应用：本地提供方是可达的，而一个因为远程身份服务宕机就拒绝启动的打包应用，已经把该服务置于主导地位。

**把 `/refresh-token` 返回的 401 也当作故障。** 被轮换的 cookie 在正常的跨标签页竞争期间就会回答 401，但被撤销或已过期的 cookie 同样如此。若将其纳入，真正已结束的会话反而无法抵达登录界面。

## 后果

Aeven 故障对已登录的读者不可见：应用启动，账户菜单从保存的 profile 中为其命名，调用凭 cookie 完成认证。在这段时间内，access token 的过期不再被强制执行，改由长期有效的 cookie 承载请求——这是该决策的代价，以 cookie 的有效期为界，并被刻意接受。

从未在此浏览器上登录过的读者，在故障期间仍会抵达登录界面，并且在 Aeven 恢复之前无法登录。已撤销的会话会一直保留，直到 Aeven 可抵达足以拒绝一次续期为止，这扩大了 `identity-user-aeven` 已就本地校验记录的时间窗。

这逆转了 [2026-09-14 注记](2026-09-14-aeven-session-survives-and-ends-visibly.zh.md)对无凭据页面的处理。该注记让已结束的会话呈现登录界面，而不是失败的外壳，其推理对仍然会跳转的拒绝成立。该注记没有区分不可达的 authority，而本注记管辖这一情形。

## 测试

`packages/client/ui-auth-aeven/tests/gate.client.spec.ts` 覆盖成功读取时写入的保存 profile、经由传输失败与 5xx 的启动、在 400 与 401 上保留的登出跳转、故障期间的首次访问、无法解析或为空的保存 profile、登出时丢弃它，以及未配置的 harness。
