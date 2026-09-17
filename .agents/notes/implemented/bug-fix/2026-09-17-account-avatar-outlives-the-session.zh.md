# Agent Note: The signed-in avatar outlives the Session

Status: implemented

[English](2026-09-17-account-avatar-outlives-the-session.md) | 中文

## Problem

全新安装不显示账户头像。登录是成功的——读者已被恢复，资料也带着其图片返回——但右上角依然是空的，而同一台机器上的 harness 只要打开会话就会显示头像。

认证链路并不缺任何一环。默认 Web 组合挂载了 `identity-user-aeven`，Host 注入了 `globalThis.__AVN_AEVEN__`，boot kernel 的 gate 调用了 `restoreSession()`，它声明了 `globalThis.__AVN_AEVEN_READER__`，其中带有读者的 `userId`、`displayName` 与 `imageUrl`。所服务的 `client-ui-account-aeven` bundle 也正确地读取了该全局变量。

缺口在座位上。账户菜单注册进 `conversation.session.header.utilities`，而该座位唯一的宿主是 `ConversationSessionHeader` 的 `.headerUtilities` 行，它位于 `ConversationRoot` 以 `sessionId === undefined ? null : (…)` 为条件渲染的 `<header>` 元素内部。冷启动没有会话，因此不渲染标题栏，座位便没有宿主，菜单也就什么都不画——尽管该菜单根本不需要任何会话事实：它是向页面询问谁已登录。

全新安装恰好就落在这个状态。没有工作区、没有会话时，`/` 停留在 hero 界面，因此新部署的第一屏正是头像无法出现的唯一一屏。3080 上的 harness 掩盖了这个缺陷：它的 `/` 会重定向到最后一个会话，而该会话的标题栏是存在的。

## Decision

会话列的导航条是常驻的，而非会话所有。

`ConversationRoot` 在 hero 与活跃会话中都渲染 `<header>`——栏体及其模糊背景。只有标题栏自身的内容仍以会话为条件，并且仍在其自身的 `renderSlot` 调用处受门控：面包屑、View tab 与会话操作在有会话时才出现。

常驻根声明了一个新座位 `conversation.navigation.utilities`（`kind: 'list'`、`scope: 'root'`）。它在每个 phase 中由同一个 `<header>` 渲染，右对齐排在会话 utilities 之后。`conversation.session.header.utilities` 保持其含义——会话存在期间才存在的会话 utilities——并保留 `session-log-export` 作为其占据者。

`client-ui-account-aeven` 改为注册进新座位。是否有人登录是关于应用而非关于会话的事实，因此展示该事实的控件属于比会话更长寿的那条栏。

它的位置没有移动。`.navigationUtilities` 以与 `.headerUtilities` 内部条目之间相同的 8px 间距续接该行，标题自身的 20px 间距仍留在 `.headerUtilities` 上：读者在任一 phase 中看到的都是他们一直看到的那一行。样式表本就预期 hero 中有栏——`.root[data-phase="hero"] .header { margin-bottom: 0 }` 的存在正是为了让栏保留其 56px 带区，而 hero composer 则在栏留出的空间中以 auto margin 居中。

## Alternatives considered

**把 `conversation.session.header.utilities` 放宽为 `session-maybe`，并由常驻 shell 渲染它。** 这样只有一个座位而非两个，但该座位会以一个并不存在的标题栏命名，而它的另一个占据者（`session-log-export`）导出的是当前会话的日志——它会不得不为一个其名称声明不可能发生的状态新增 `sessionId === undefined` 守卫。

**把菜单注册进 `shell.overlay`。** 该 frame 级层是可叠加的且在每个 phase 都存在，但它横跨整个 frame：详情列打开时它的右边缘不是会话列的右边缘，头像会漂离它与会话日志按钮共享的那条栏。

**在两个座位各注册一次，按 phase 各用一个。** 视觉上等价且 diff 更小，但这是把同一个控件注册两次，而读者从不会看到两次；此后菜单的每次改动都要在两处同时进行。

**让标题栏在 hero 中也渲染。** 它的标题、tab 与操作都读取当前会话，因此 hero 标题栏意味着把 `ConversationSessionHeader` 变成会话可选组件，只为在 hero 标题上方画一行空标题行。

**就这样：读者打开会话，头像就出现了。** 账户控件是读者登出、切换夜间模式、进入账户页的途径。首屏无法触达它的部署，会呈现一位它无法辨识的已登录读者；而这个缺陷恰好在新安装启动时的那个状态里不可见。

## Consequences

在全新安装的首帧以及登录之后立即，即使没有打开任何会话，头像都在那里，并且显示读者的真实图片而非占位符。

hero 如今带有一条 56px 的导航条，因此其 composer 在栏下方的带区中居中，而非在整列中居中——这正是 hero 规则所写的方式；在常规高度的列上大约比之前低 28px。

会话行为不变：头像仍在同一个角落、同样大小，与会话日志按钮仍隔 8px，且始终只有一个。

会话列中现在有了一个承载应用级控件的座位，而在两个 utilities 座位之间做选择的规则正是缺陷之所以存在的原因：读取会话事实的条目属于 `conversation.session.header.utilities`，读取应用事实的条目属于 `conversation.navigation.utilities`。`ui-account-aeven` 与 authority 一同挂载，因此停用 `identity-user-aeven` 的部署仍会随之停用它。

## Testing

`packages/client/ui-conversation/tests/skeleton.client.spec.tsx` 固定了两个 phase：冷启动用例断言在未选择会话时栏与导航座位会渲染，而标题栏、其 utilities 与会话体完全不会被派发；活跃 phase 用例断言会话各座位与导航座位一同渲染。

`packages/client/ui-account-aeven/tests/browser-plugin.client.spec.ts` 声明新座位，并覆盖等待它、拆除其条目，以及菜单所读取的注入面。

`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` 已重新生成，因此新座位的契约、声明者与占据者与其他每个接缝一样，从同一来源发布；`docs/subsystems/slots.md` 在既有层级中列出了它。
