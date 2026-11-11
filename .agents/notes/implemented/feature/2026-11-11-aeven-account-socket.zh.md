# Agent Note: Aeven 账户 socket 结束会话并传递语言

Status: implemented

[English](2026-11-11-aeven-account-socket.md) | 中文

## Problem

Aeven 网站（aeven.io）与 web 客户端（chat.aeven.io）共用同一个 Aeven 会话：网站从客户端的 API 设置的 refresh cookie 中读取它。在网站上退出登录会在 API 端结束会话，但已打开的客户端标签页会继续工作，直到它持有的 access token 过期，最长两小时。该标签页出示的 token 在 Host 端仍能本地验证通过，在 API 端仅按签名验证，而 watcher 只在续期时才询问 API。账户语言也有同样的缺口。客户端会把语言写入账户（`prefs.locale`）用于邮件，但只读取自己的 Host 偏好，因此在网站上选择的语言永远到不了客户端。

## Decision

只要页面的会话存在，客户端就持有 Aeven API 的账户 socket。`watchSession` 通过 `openAccountSocket` 打开它，并在自身的 disposer 中关闭。socket URL 是部署层面的事实：`identity-user-aeven` 接收 `socketUrl`，并按请求所用的 loopback 写法，把它与 `apiUrl` 一起写入 `__AVN_AEVEN__`。hosted bundle 从 `AEVEN_SOCKET_URL` 读取它，默认为 `wss://aeven.io/socket`，即 API 的 socket，而不是 Host 自己的 `/socket`。未配置时客户端不打开任何连接，行为与以前相同。

浏览器无法在 WebSocket 上设置 `Authorization`，因此页面把 access token 作为子协议 `aeven.bearer.<token>`，与 `aeven.account` 一起提供。API 以 `aeven.account` 应答，从不回显 token。Remote stream socket 采用同样的形式。不使用 refresh cookie，因为它属于设置它的那个主机，并指向最后登录的账户。

客户端只处理两种帧，并在线路边界检查其结构：

- `{"type":"session.ended"}`：会话在任一页面退出登录或被吊销时，API 在关闭该会话的所有 socket 之前向每个 socket 发送此帧。客户端调用 `leaveForSignIn`，丢弃持有的 bearer，因此客户端的其他标签页除了通过自己的 socket，也会通过 storage 监听器跟着退出。
- `{"type":"account.locale","locale":"…"}`：`/set-locale` 保存语言时，API 向该账户的所有 socket 发送此帧。watcher 把语言记录到会话上，并通知 `onAccountLocale` 的监听器。发布的 reader 携带 `locale`（来自 `/get-profile` 的账户语言）和 `onLocale`。`ui-account-aeven` 在启动时以及监听器触发时，通过 `ctx.locale.setLocale` 应用该语言。应用不提供的语言或已在使用的语言不会引起任何变化。

自行关闭的 socket 在五秒后用页面当时持有的 token 重新打开。握手在打开前就被拒绝的 socket 会用续期后的 token 重新打开，因此不再提供已不对应任何会话的 token，而确实已结束的会话会表现为续期被拒绝。关闭码 1000（在 `session.ended` 之后）和 1008（没有存活的会话）为最终状态。

API 根据 token 的 `sid` claim 确定 socket 所属的会话，每一对 token 都携带它，轮换时保持不变。网站和客户端为同一个会话持有不同的 access token，而会话行只保存最新的哈希，仅按哈希匹配会使其中一方匹配不上。

## Alternatives considered

**来自 chat.aeven.io 的隐藏同站 iframe，用于清除客户端的存储。** 客户端现有的 storage 监听器会让其标签页退出，客户端代码无需改动。但它需要一个唯一用途是触及另一个 origin 存储的页面，而且无法传递语言，因为语言保存在 Host 偏好中而不在浏览器存储里。

**在 `aeven.io` 子域之间共享的 cookie。** 它无需改动服务器，但 cookie 的变化只能通过 Cookie Store API 即时观察，而并非所有浏览器都支持它。其他浏览器只能轮询，并且语言仍需要客户端代码来读取。

**在标签页变为可见时重新检查会话。** 它只在读者回到该标签页时才弥补缺口，每次都要轮换一次 refresh token，也不传递语言。

**让 API 拒绝已结束会话的 access token。** 这是另一项独立的加固措施。它能消除从页面中复制出的 token 的吊销窗口，但已打开的标签页仍要到下一次请求才会得知会话结束。

## Consequences

每个已登录的客户端标签页多持有一个连向 Aeven API 的 WebSocket。在任何地方退出登录，都会让该会话的所有已打开页面立即退出；在任何地方设置的语言，都会到达该账户在所有设备上的所有已打开页面。`identity-user-aeven` 中记录的本地验证吊销窗口，对于从页面中取出的 token 依然存在。未设置 `socketUrl` 的部署保持以前的行为，即在下次续期时才得知会话已结束。
