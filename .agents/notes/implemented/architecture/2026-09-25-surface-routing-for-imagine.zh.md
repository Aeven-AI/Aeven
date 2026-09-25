# Agent Note: Full-page surfaces own a path root; the chat owns only `/` and `/c`

Status: implemented

[English](2026-09-25-surface-routing-for-imagine.md) | 中文

## Problem

Imagine 需要一个位于 `/i/<id>`、与对话 Session 相互分离的独立页面。客户端此前无法显示这样的页面。中间栏总是渲染 `conversation` slot，而对话的地址投影（ui-workspace 中的 `BrowserSessionUrlNavigation`）把整个地址栏视为己有：无法读作 `/c/<uuid>` 的地址会被改写为当前对话，后退或前进到这类地址会开启新会话。Host 也只为其列出的客户端路由根提供应用，因此 `/i/<id>` 返回 404。

## Decision

**界面路由归 ui-layout 所有。** `ctx.layout.surfaces` 是基于 History API 的小型路由。界面注册它所拥有的单段路径根（`register({ id, root })`，返回释放函数；格式错误的根或冲突的 id、根会在注册时抛出）。`current` 是一个 hook 数据源，给出拥有当前路径的界面，没有则为 undefined；它跟随 popstate 以及路由自身的 `push`/`replace`，因为 History 写入不会触发事件。AppFrame 在该 id 下渲染 keyed、root 作用域的 `surface` slot 以取代 `conversation`，并在界面显示期间把 `details` 与 `rightbar` 两栏视为关闭，因为两者都属于当前对话 Session。它们的存储状态保持不变，因此对话会按读者离开时的样子重新打开。

**对话自行声明其地址空间，而不是询问路由。** `BrowserSessionUrlNavigation.ownsAddress()` 对 `/`、`/c` 与 `/c/…` 为 true。在其他任何地址上，投影不读取 Session，也不写入任何内容，`navigateFromUrl` 会忽略它，因此后退到 Imagine 不会开启新会话。Session 的协调本身在 Imagine 地址上照常运行：启动时仍会选中或创建一个对话 Session，而 `whenInitialDataReady` 与页面预加载层正是在等待它。

**Imagine 只是可能的多个界面之一。** `@aeven/client-ui-imagine` 声明 `/i`，把裸 `/i` 或非 UUID 的 id 原地改写为新的 `/i/<uuid>`，并在 `imagine` 键下注册页面。该 id 不指向任何 Session。`frontend-static` 把 `/i` 列入其客户端路由根。

## Alternatives considered

**让对话导航了解 Imagine。** ui-workspace 可以对 `/i` 做特殊处理或查询路由。未采用：那样对话就要了解每个界面，新增界面也要修改对话导航。只拥有 `/` 与 `/c` 无需任何依赖，并对以后的任何界面都成立；应用从不在认证路由上启动，认证页会在插件图启动前把读者送往目的地。

**在界面之下保持对话挂载。** 隐藏对话可以保留其滚动位置，但对话输入框挂载时会夺取焦点，并会在页面背后持续接收按键。因此对话被卸载；其草稿保存在 Session 状态中，而不在组件里。

**为整个中间栏使用 chain slot。** 让 `conversation` 成为 chain 的一个条目可以让界面自行当选，但这会为所有部署改变对话的注册方式及其 session-maybe 作用域。在不变的 `conversation` slot 旁新增 keyed 的 `surface` slot，对话完全不受影响。

## Consequences

一个界面就是一个路径根加一个页面：新增界面无需修改 ui-layout、ui-workspace 或对话。Host 的路由根列表仍是固定列表，因此每个新根都要在那里加一行。界面之下对话 Session 仍保持选中，因此右上角的右侧边栏开关在面板隐藏时仍作用于该 Session 的面板。在两个输入框共用组件之前，Imagine 起始页重述了对话首屏输入框的 CSS；其 README 列出了这一点。
