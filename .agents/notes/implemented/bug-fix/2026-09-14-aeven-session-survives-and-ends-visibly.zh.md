# Agent Note: Aeven 会话在续期中存活，并在结束时可见

Status: implemented

[English](2026-09-14-aeven-session-survives-and-ends-visibly.md) | 中文

## Problem

已登录的读者偶尔会丢失 Aeven 会话，而页面没有回到登录界面：每个 RPC 调用都失败，外壳停留在加载状态，直到手动刷新。

两个缺陷叠加。Aeven API 在每次 `/refresh-token` 交换时轮换 refresh token，只接受最新的 token（`Session.findOne({ userId, refreshToken })`），并在拒绝时清除两个 cookie。`currentBearer`（`packages/client/ui-auth-aeven/src/client/auth/services/tokens.ts`）按调用方各自刷新，因此当 access token 失效时，已启动外壳发出的并行 RPC 调用各自出示同一 cookie；第一次交换轮换了它，其余被拒绝，从而清除 cookie 并结束会话。另外，gate 只在插件图启动前恢复会话，启动后没有任何逻辑把拒绝转为登录界面，于是页面在没有凭据的情况下保持已启动状态。

## Decision

刷新被串行化。同一标签页内的调用方共享一次进行中的续期，同一 origin 各标签页之间的续期持有 `aeven-session-refresh` Web Lock，并在获得锁后重新读取已存储的 token，采用另一个标签页的新 token，而不是用已轮换的 cookie 交换。`currentBearer(rejected)` 绝不返回调用方已见被拒绝的 token。

`installAuthenticatedTransport` 还会启动 `watchSession`（`auth/services/watch.ts`）。它在 bearer 不再可用时（过期前两分钟）续期，并在页面重新可见或网络恢复时再次续期；每次续期都会轮换有效期一年的 refresh token，因此打开的页面保持登录。Host 返回 401 时续期 bearer 并重试该调用一次。拒绝（`/refresh-token` 返回 400 或 401）或另一个标签页登出后移除的 bearer 会调用 `leaveForSignIn`，它删除持有的 bearer，把路径记入 `authReferrer`，并加载 `/sign-in`。传输失败或 5xx 保留会话，并在 30 秒后重试。

## Alternatives considered

**在 API 上于宽限期内接受上一个 refresh token。** 这同样消除竞争，包括共享 cookie 存储的不同客户端之间的竞争，但它改变了 Aeven 服务端的 token 模型，也没有解决缺失的登录跳转。客户端串行化无论如何都需要；服务端宽限期仍是互补的加固。

**任何 Host 401 都跳转。** 如果 Host 拒绝一个 Aeven 仍接受的 bearer（密钥不匹配或时钟偏差），页面会在恢复会话的登录 gate 与已启动页面之间循环。只有 Aeven 的拒绝才判定会话已结束。

**离开时保留持有的 bearer。** 该 token 在过期前仍能在本地校验通过，因此 gate 会用它恢复会话，再次启动进入同样的失败。

## Consequences

打开的页面会无限期续期会话，已结束的会话会呈现登录界面，而不是失败的外壳。纯 HTTP 部署没有 Web Locks，因此其两个标签页仍可能竞争；每个标签页只串行化自身的调用方。在没有 HTTP 调用进行时被拒绝的 WebSocket 载体，会在下一次续期、可见性变化或网络恢复时被发现，而不是立即发现。

## Testing

`packages/client/ui-auth-aeven/tests/watch.client.spec.ts` 覆盖单次进行的续期、在锁下采用另一个标签页的 token、被拒绝 token 的强制续期、拒绝时的跳转与 bearer 删除、传输失败时的保留、Host 401 重试、跨标签页登出，以及过期前的定时续期。
