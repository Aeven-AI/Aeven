# Agent Note: Naming the reader

Status: implemented

[English](2026-09-17-naming-the-reader.md) | 中文

## Problem

对于从未选择过名字的读者，AVN 没有任何名字可用。API 提供 `displayName` 时 `ui-account-aeven` 就画出来，没有提供时就什么都不画，因此全新账号显示的是一条空的资料行，账户菜单则把他称作无名氏。

Aeven 把读者选择的名字与其选择标记一起记录在账号上：`/get-profile` 回答 `displayName` 与 `displayNameSet`，`POST /set-display-name` 写入这一对值。Aeven 客户端会去询问。其 `Home` 在 `displayNameSet` 不为 true 时用 `initCheck` 界面取代聊天，因此从未为自己命名的读者会看到「Hi there! / Before we continue to chat, how should I call you?」，若部署已推导出名字则预先填入，且在回答之前无法进入聊天。

AVN 既不读该标记，也不读该路由。profile 中的 `displayNameSet` 在采纳时被丢弃，而客户端根本没有任何可以设置名字的调用。

## Decision

名字是识别读者的一部分，因此 boot kernel 的 gate 会询问它，与它已经挂载的登录界面并列。

`restoreSession` 增加第四种状态 `unnamed`：只要恢复出的 profile 不带 `displayNameSet === true` 就如此回答——无论 API 回答 `false`、对从未选择过的账号省略该字段，还是在中断期间从保留的 profile 恢复而来。`AppWebEntry` 在该状态下挂载命名界面并把应用挡在它之后，与面对未认证读者时完全一致。

`packages/client/ui-auth-aeven/src/client/auth/views/NameCheck.tsx` 就是该界面，从 Aeven 客户端的 `initCheck` 移植而来：问候语、原版对空输入的那句话（"You don't have to be anonymous with me ;)"）、由 `session.displayName` 预填的名字输入框，以及 Continue。其提交在发送前先剥离读者看不见的字符，对空名字不发请求就直接拒绝，并在原位报告被拒绝的保存。

`setDisplayName` 携带 bearer 提交 `/set-display-name`，随后通过 `session.adoptDisplayName` 采纳回答：它同时移动 `displayName` 与 `displayNameSet`，并把两者写回保留的 `aevenProfile`——若保留的 profile 仍写着 `false`，下次加载会再次回到该界面。bearer 被拒绝时会把读者送到登录界面，而不是把他留在一个无法成功的界面上。

成功后的去向与登录界面相同：读者自己请求过路径时用 `authReferrer`，否则用应用根路径。gate 随后再次读取 profile，找到一份带有名字的 profile，应用随即在挂载该界面的那份文档中启动。

该界面的样式表是 Aeven 的 `_initCheck.scss` 在本应用作用域下的版本，外加该界面在源头从 `_home.scss` 继承的那一条规则——首页栏的 `.content-container`，正是它的 flex 纵向布局与满高让 `.form-container` 得以居中。68px 的问候语使用本应用自带的 Google Sans Flex 字族，因为 Aeven 样式表的 vendored 副本已丢弃其声明过却从未使用的 Bodoni 字体。

## Alternatives considered

**在运行中的应用之上弹一个模态框。** 它能让侧边栏与账户头像在提问背后保持可见，这正是 Aeven 客户端版本的做法。但 AVN 唯一始终存在的表面是覆盖整个 frame 的 `shell.overlay`，而一个无法关闭的模态框会让读者面对一个用不了的应用；gate 本就拥有「这个页面还不属于你」这一状态，而该界面正是这个状态。

**接管会话栏。** 它会把提问放在与参考实现完全相同的位置。`conversation.composer` 正是为此而设的接缝，但它在冷启动时被刻意置为空转（`fallbackOnly: sessionId === undefined`）——而冷启动恰是全新安装所处的唯一状态，因此该界面会恰好在其最需要的地方不可见。

**在账户页询问，那里已经可以编辑名字。** 这样不会阻塞读者，但也不会让他拥有名字，而每个称呼他的表面都会继续显示一个 id。

**允许读者跳过。** API 拒绝空名字，因此「跳过」只能意味着「下次加载再问」。参考实现在该回答上阻塞；本实现同样如此。

**把省略的 `displayNameSet` 视为已命名。** 那样会让旧 API 的读者直接通过，但也会让每个从未选择过名字的读者直接通过：该字段恰恰是为他们而缺席的。

## Consequences

新账号在登录与应用之间会遇到一个界面，使用读者的语言，并预先填入部署已经为其推导出的名字。回答之后，名字就在账号上：账户菜单显示它，之后每次加载都直接通过，在另一台机器上登录也不会再问。

该提问是硬性门槛而非建议，Aeven 客户端也是如此：未命名的读者既到不了 composer，也到不了应用的任何其他部分。完全省略 `displayNameSet` 的部署——即早于该字段的部署——会每次加载都询问每位读者一次；它提交的路由与 Aeven 客户端提交的路由相同，因此满足参考实现的部署也满足本实现。

该界面是 gate 可以挂载的第三个界面，也是第一个与凭据无关的界面。`AuthGateResult` 携带它，因此 kernel 依据一个回答决定读者去向，而不必向库询问两次。

在本客户端认识该标记之前保留的 profile 无法声称拥有名字，因此升级后第一次无法抵达 API 的加载会落到该界面；下一次能抵达 API 的加载会用真实回答重写保留的 profile。

## Testing

`packages/client/ui-auth-aeven/tests/gate.client.spec.ts` 覆盖在线 profile 缺少该标记、标记为 false、标记为 true，以及中断期间保留 profile 的两种读法。`api.client.spec.ts` 覆盖 `/set-display-name` 所带的 bearer 与请求体、被采纳的名字、它所重写的保留 profile，以及被拒绝的名字。`session.client.spec.ts` 覆盖 `adoptDisplayName` 同时移动两半，以及未保留 profile 的页面。`packages/client/web/tests/boot.client.spec.ts` 端到端驱动 kernel 的 `unnamed` 分支：界面被挂载、文案被渲染，背后没有启动应用的任何部分，而读者在此命名之后，应用就在那份文档中启动。
