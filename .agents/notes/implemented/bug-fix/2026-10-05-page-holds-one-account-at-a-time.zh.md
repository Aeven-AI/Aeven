# Agent Note: Web 页面同一时刻只持有一个账号

Status: implemented

[English](2026-10-05-page-holds-one-account-at-a-time.md) | 中文

## 问题

一位读者在多个标签页中打开 Web GUI 时发现自己的历史记录消失了：侧边栏只显示少量会话，而已经打开的对话报告 `Failed to load history: session "session-…" not found (session/not-found)`。在该标签页中退出再重新登录即可恢复一切，这也是该报告以「UI 当时所处的状态大概是没有登录」的形式提交的原因。

没有任何持久数据丢失。每个会话日志都完好，只要页面重新只持有一个身份，Host 对同一读者的相同读取就给出相同结果。该状态完全属于这个 document 自身：

- `appBearers` 与 `userId` 按 origin 区分，因此 GUI 的每个标签页共享它们。某个标签页的登录会把它的账号 id 写在那里。
- `heldBearer()` 读取该 id，把它采纳进页面会话（`session.userId = userId; session.userSignedIn = true`），并返回该账号的 token——而此时这个 document 恢复出的是*另一个*读者，且既不改变账号菜单所绘制的读者，也不改变对话面板已打开的会话。
- 当 API 应答一次续期时，`exchangeRefreshCookie()` 做了同样的事：refresh cookie 属于最后登录的那个标签页，因此一次交换可能返回另一个账号的授权，而页面采纳了它。

从那时起，document 渲染的是一个账号的外壳，读取的却是另一个账号的会话。Host 应答 `session/not-found` 是正确的：另一个账号拥有的会话读起来与不存在的会话完全相同（[`callerMayAccessSession`](../../../../packages/api/session-controller/src/agent.ts)，[共享 Host 上按账号隔离](../architecture/2026-09-30-per-account-isolation-on-a-shared-host.zh.md)）。会话列表按同一规则过滤，因此侧边栏只显示被采纳账号拥有的内容——读者自己的历史记录就这样消失了。

watcher 的多标签页防护只覆盖了其中一半：`onStorage` 只对 `appBearers` 失去*本*页面的 bearer 作出反应，从不针对 `userId` 指向他人，并且完全忽略 `userId` 事件。

还有两条相关的死路，使同样的状态在没有其他标签页时也能出现：

- 对任何不是拒绝的失败（包括传输失败），`restoreSession()` 都会用保留的 `aevenProfile` 重建一个已登录的应用。当 refresh cookie 仍能识别浏览器时，这是刻意为之（[Aeven 故障期间应用保持运行](2026-09-15-aeven-outage-leaves-the-application-running.zh.md)），但 Host 对未携带 bearer 的请求应答 401，恰恰证明它已经不能识别。
- `installAuthenticatedTransport` 在没有可续期的 bearer 时原样返回 Host 的 401，因此没有任何东西结束会话，页面继续发起调用。

## 决定

**在 document 自身登录之外的账号变更会结束该 document 的会话。** `tokens.ts` 永不采纳已存储的 id，也不采纳指向另一个账号的交换授权：`servesPage()` 拒绝两者，交换会报告 [`IDENTITY_CHANGED_CODE`](../../../../packages/client/ui-auth-aeven/src/client/auth/services/errors.ts)，而不是存储授权。`watch.ts` 把那一点——以及指名另一个账号的 `userId` 存储事件——转成 `replacePageAccount()`，后者重置页面会话并通知 `onSessionEnded`。启动内核已经拥有该信号（[会话结束会把页面交还登录门禁](2026-09-22-session-end-hands-the-page-back.zh.md)）：它 dispose 插件树并再次运行登录门禁，因此整个 document 会以浏览器当前所持凭据对应的账号重建，并带上该账号的读者、导航和历史记录。

与 `leaveForSignIn()` 不同，`replacePageAccount()` 不丢弃任何已存储的 bearer。取代本页面账号的那个账号处于已登录状态；它的会话属于建立它的标签页，在这里删除它的 token 会让那个标签页退出，而不是让本页面退出。

**在两段会话之间，传输层不携带任何凭据。** 从 document 的会话结束那一刻起，直到随后的登录门禁启动自己的 watcher 为止，`pageIsLeaving()` 都为真，该钩子直接应答 401，不触及 Host。在该窗口内发出的请求会被取代本页面账号的那个账号的 refresh cookie 认证——同一个缺陷换了一条路径。故障期间的行为不变：传输失败会保留会话，请求仍然在没有 `Authorization` 头的情况下发出，交给 cookie 去识别，这正是 `packages/client/ui-auth-aeven/README.md` 所记载的行为。

**Host 的拒绝会结束会话，无论请求携带了什么。** 对携带 bearer 的请求应答 401 会先续期并重试一次，与之前相同。对未携带 bearer 的请求应答 401 无法续期：cookie 同样没有识别出任何人，因此会记录 `noteHostRefusal()`，页面转到登录界面。随后，对这一次恢复，`restoreSession()` 拒绝用保留的 profile 重建读者，因此每次调用都无法通过认证的页面会显示登录界面，而不是一个看起来已登录的应用。该闩锁由下一个登录门禁启动的 watcher 清除，读者登录成功也会清除它。

## 考虑过的替代方案

**让页面采纳浏览器存储的账号，并重新加载它显示的会话。** 已否决：这会让渲染出的读者、账号菜单和已打开的对话仍属于登录门禁恢复的那个账号，而页面却以另一个账号行事，这正是要移除的状态。读者也将无法判断自己正在以哪个账号行事。

**只在存储事件上重新运行登录门禁，不在 `heldBearer`/`exchangeRefreshCookie` 中加防护。** 已否决：存储事件不会在写入的标签页中触发，在 document 被挂起或从前进／后退缓存恢复时可能被漏掉，而且续期路径会先到达 API 而不触碰存储。两处采纳点的防护才让「一个 document，一个账号」成为不变量，而不是一场竞态。

**像 `leaveForSignIn()` 那样丢弃另一个账号的 bearer。** 已否决：这会结束一个本 document 从未参与的会话。刚刚登录的读者会被一个自己没在看的标签页登出。

**完全什么都不发，让调用方在页面处于两段会话之间时自行失败，不返回 401。** 已否决：连接插件的调用方已经把非 OK 响应当作传输失败，而合成的 401 恰好说明了发生的事——这个 document 没有会话可携带。

## 后果

现在一个 document 在其整个生命周期内只以一个账号运行。其他标签页的登录会把它重建为该账号，而不是半途采纳；账号菜单、会话列表和已打开的对话会一起改变。Host 拒绝其会话的页面会进入登录界面，而不是发出无法通过认证的调用。

`packages/client/ui-auth-aeven/tests/watch.client.spec.ts` 覆盖三项新行为：其他标签页的登录结束本 document 的会话，同时保留两个已存储的 bearer；以另一个账号应答的续期被拒绝，且不存储任何内容；持有另一个账号已存储凭据的页面向 Host 不携带任何凭据（host mock 从未被调用，调用方看到 401）。它还覆盖了不带 bearer 的 Host 401：会话结束、拒绝被记录，且地址不被移动——那是内核的职责。`packages/client/ui-auth-aeven/tests/gate.client.spec.ts` 固定了：一旦 Host 拒绝过该页面，保留的 profile 就再也不会恢复读者。已有的「其他标签页*退出登录*仍会报告会话结束」测试未改变并且通过，忽略不影响本读者登录状态的存储变化的测试同样如此。

测试用例 `retries a Host 401 once with a renewed bearer` 把断言收窄到被测的那一次调用：安装传输层同时会启动 watcher，而 watcher 在 `api/credential` 上的凭据交接携带同一个 bearer，因此记录每个请求会让期望取决于微任务顺序，而不是取决于重试。
