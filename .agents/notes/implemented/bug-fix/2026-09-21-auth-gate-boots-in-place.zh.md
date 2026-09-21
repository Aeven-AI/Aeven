# Agent Note: 认证 gate 等待读者完成，并在原位启动应用

Status: implemented

[English](2026-09-21-auth-gate-boots-in-place.md) | 中文

## Problem

邮件登录呈现出一段读起来像失败的过渡：按钮转圈、按钮回到空闲文字、预加载页毫无动画地出现并硬切到应用。读者看到的是进度中断，然后页面从头开始。

这三个症状同出一因。`AppWebEntry` 把认证当作一次判断，而不是一次等待：

```ts
if (await this.gateOnAuthentication()) {
  hidePreloader()
  return            // the boot ends here, with no plugin graph behind it
}
```

`gateOnAuthentication()` 挂载界面后立刻作答，于是在其之后完成登录的读者拥有一份会话，却没有任何东西在运行它。启动应用仅剩的途径是再次加载文档，`mount.tsx` 正是被逼到了这一步：

```ts
window.location.assign(window.location.pathname + window.location.search)
```

另有两个缺陷源于同一原因。`Authenticate.tsx` 在跳转前于成功路径上清掉了登录按钮，读者因此在等待与过渡之间看到一枚空闲按钮。而被重新加载的文档从服务端 HTML 重绘了 `#avn-preloader`，它按设计在首帧是不透明的，因此无法淡入。

邮件登录从不需要文档加载。只有 provider 登录会离开该 origin，而它离开的理由是 gate 改变不了的。

## Decision

gate 是一次等待。`AppWebEntry.gateOnAuthentication()` 循环直到会话存在，紧随其后的启动发生在读者已经身处的文档中：

- 每轮迭代都读取 `restoreSession()`；`disabled` 与 `authenticated` 直接返回，且已认证分支仍会在插件图启动前调用 `installAuthenticatedTransport()`，因为连接只在那一刻依据传输钩子所持有的内容构建一次调用方。
- 其余任何状态都挂载拥有它的界面——`unnamed` 对应命名步骤，否则是路由对应的界面——并 `await` 该界面的完成。
- 循环重新读取会话，而不是相信界面。因此一份没有选定名字的已恢复 profile 会落到命名步骤而不是应用，这正是 `unnamed` 的含义，无论它来自第一次读取还是登录之后的读取。
- 每个界面渲染到挂载点之前都会执行 `this.page.dispose()`，因此每个界面、以及最终的应用都会拿到一个空闲的容器。
- 容器在界面落定之前属于该界面。`authenticated` 状态并不意味着可以往界面仍占有的容器里渲染。

`MountedAuthScreen` 新增 `readonly authenticated: Promise<void>`，在读者带着已建立的会话离开该界面时落定：

- `mountAuthScreen` 从原先调用 `window.location.assign` 的同一条 `popstate` 路径落定——界面以移动到一条非认证路由来报告成功，该移动来自它们自己的 `navigateRoute`，或来自 `OauthResult` 的交换。
- `mountNameScreen` 从 `NameCheck` 的 `onNamed` 落定，位于 `window.history.pushState(null, '', destination())` 之后。应用在启动时读取该地址，而此时并没有已挂载的应用能听到一次导航。

遮罩只覆盖那段等待，不多不少。界面占有页面时执行 `hidePreloader()`——静态预加载页不能盖住登录输入框。界面一落定就执行 `showPreloader()`，早于随后的会话复读与启动：这是登录按钮不再代表任何进度的最早时刻，而其后的过程本来也不是读者能观看的。`run()` 末尾的 `hidePreloader()` 在已挂载的外壳之上将其淡出（[何时解除](../../implemented/bug-fix/2026-09-08-web-preloader-waits-for-shell-data.zh.md)）。

`Authenticate.tsx` 不再于成功路径上清除登录按钮。其错误路径仍然清除：凭据被拒或 API 不可达都会把读者留在该界面上，此时按钮必须重新可用。

## Where a document still loads

仍有两处，均为有意保留，且都不在邮件登录路径上：

- provider 登录以 `Authenticate.signInOauth` 中的 `location.href = oauthUrl` 开始，它离开该 origin 前往 provider 自己的授权界面。provider 把读者送回本部署的 `/oauth-result/...`，那是 kernel 的一次全新启动，并到达 `OauthResult`。返回段现在是一次加载而不是两次：`OauthResult` 通过 `navigateRoute` 报告成功，该调用使已挂载的界面落定，并在那份文档中启动应用。起始段是否根本不需要该文档，以及桌面部署是否应让应用窗口完全不参与其中，仍是未决问题——桌面外壳已经在独立窗口中抵达 provider，随后又用 `loadURL` 丢弃了自己的应用窗口。
- 应用启动之后会话结束时，`leaveForSignIn()` 会加载 `AUTH_ROUTES.signIn`（[会话结束之时](../../implemented/bug-fix/2026-09-14-aeven-session-survives-and-ends-visibly.zh.md)）。要在原位完成这一点，需要正在运行的应用把页面交还给 gate，而目前没有任何界面这样做。

## Alternatives considered

**保留该加载并为交接加动画。** 报告的症状是硬切，因此省事的改动是在跳转前把遮罩淡入，让重新加载再把它淡出。已否决：读者仍然会失去文档，重新加载恰恰是不透明重绘遮罩的成因，而 kernel 本就已具备原位启动所需的一切。

**让界面回调 boot。** 用一个 `onAuthenticated` 回调，或把一个 gate 对象交给 `mountAuthScreen`，都能替代该 promise。已否决：一个落定点就是一个事实，而 promise 就是带着归属者的该事实；回调式表面会招来第二个调用方与第二种含义。

**在界面背后启动应用。** 立刻挂载插件图，把它藏在认证界面之下，并在会话存在后揭示。已否决：未认证的插件图正是"在插件图之前运行 gate"要防止的东西，而且它会把每个客户端条目的激活与首次数据读取都摆在一位还用不上它们的读者面前。

**用 `location.replace` 替代 `assign`。** 已否决：它修的是历史记录条目，不是那次加载。

## Consequences

读者的进度不再中断：按钮保持其状态，遮罩在等待期间淡入，并在已挂载的外壳之上淡出。邮件登录、命名步骤，以及 `redirect` 模式的 provider 返回，全部在它们开始时的那份文档中完成，而这同样是桌面部署唯一能接受的形态。

gate 现在拥有的是一段控制流循环，而过去它是一个条件，因此一个永不落定的界面会永远把启动挂住。这正是"读者尚未完成"的本意，而 `mount.tsx` 是这些 promise 的唯一产出者。

`packages/client/ui-auth-aeven/src/client/auth/views/*.tsx` 被排除在逐文件覆盖率之外，并保持与 Aeven 客户端源版本可 diff，以便一份样式表同时治理两者；从 `Authenticate.tsx` 删除两行会使该 diff 产生分歧。`packages/client/web/src/*` 与 `auth/mount.tsx` 同样在逐文件门禁之外，因此本决策实现所在的这两个文件都没有覆盖率证据。它的保障是行为：`packages/client/web/tests/boot.client.spec.ts` 驱动读者走完登录界面与命名步骤，并断言两种情况都在同一份文档中挂载应用——两种情况在改动前的源码上都会失败。

`installAuthenticatedTransport()` 返回的 disposer 并不被 boot 保留：条目 dispose 之后页面仍保留该传输钩子，这是该函数自身的约定。启动之后才结束的会话仍通过一次文档加载离开，如上所述。

## Testing

`boot.client.spec.ts` 围绕一个可启动页面 fixture 增加了 gate 套件，预加载页套件现在也共用它：

- **登录。** API 在读者的请求成功之前拒绝所有路由，gate 挂载 `/sign-in`，其背后没有挂载应用的任何部分。测试随后触发该界面成功路径所触发的东西——一次指向应用根路径的 `pushState` 及其后的 `popstate`——并断言 fixture 渲染器在那份文档中挂载，且遮罩已被解除。
- **命名。** profile 的回答不带 `displayNameSet`，因此 gate 挂载命名步骤并把应用挡在其后。测试向真实的 `Input` 输入一个名字、点击 Continue，并断言应用完成挂载。

`Input` 的值是通过元素原型的 setter 写入，并以 `input` 事件宣告的，因为 React 会跟踪它渲染的每个节点的值，而直接赋值是一次被跟踪的写入，界面从中读不出变化。

## Related

- [命名读者](../../implemented/feature/2026-09-17-naming-the-reader.zh.md) 拥有命名步骤与 `unnamed` 状态；本注记改变的是其成功之后落到哪里，而不是它询问什么。
- [浏览器 token 认证](../../implemented/architecture/2026-08-24-browser-token-authentication.zh.md) 拥有 bearer 以及 `installAuthenticatedTransport()` 所安装的传输钩子。
- [静态 web 外壳预加载页](../../implemented/bug-fix/2026-09-02-static-web-shell-preloader.zh.md) 拥有遮罩的标记与 CSS 状态。
