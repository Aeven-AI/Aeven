# Agent Note: The desktop window opens links through the client, and the client describes its own right-click menus

Status: implemented

[English](2026-10-10-desktop-link-and-file-menus.md) | 中文

## Problem

在桌面窗口中，点击回复里的链接没有任何反应。Markdown 引擎把每个普通链接渲染为 `<a target="_blank">`，因此这次点击进入 Chromium 的新窗口路径，而 shell 拒绝页面请求的每一个窗口；同一导航守卫也以同样方式拦下了就地跳转这一分支。客户端中没有任何地方把会话里的链接导向别处，shell 的右键菜单只提供复制链接，所以读者完全无法抵达链接的目标。

另一半是缺失而非损坏。回复中提到的产物文件——以及产物文件卡片的行——是可点击的，但它的唯一动作是"用桌面默认应用打开"。读者若想把文件在文件管理器中显示、用某个特定编辑器打开，或把路径带走，就无处可去；窗口自身的右键菜单也帮不上忙：Electron 的 `context-menu` 事件携带的是链接和图片，而不是"指针落在这个应用的哪个元素上"。

## Decision

**有一条策略掌管链接落到哪里，它位于客户端。** `installLinkHandling`（ui-sidebar-browser `src/client/links.ts`）只在桌面 shell 提供其桥接时安装；通过 HTTP 提供服务时，链接由标签页自己打开，这正是浏览器的既有行为。它的三个去处是右侧边栏中本会话的浏览器面板、agent 的 DevTools 工具所驱动的 Chromium（`remote.browserChromium`），以及操作系统的默认浏览器。系统浏览器这一去处优先选择被驱动的 Chromium，因为 agent 框架的读者希望 agent 看到它被展示的那个页面；当没有 Chromium 响应时，回退到 shell 的 `openExternal`。

**shell 报告地址，而不是打开地址。** `openContentAddress`（`apps/desktop/src/external-links.ts`）是窗口的新窗口处理函数和导航守卫所调用的东西。通过 `links.onOpen` 订阅过的页面会收到该地址并自行打开；其他任何页面——shell 自己的窗口、由另一个构建提供服务的 Host，以及所有非 `http(s)` 协议——仍走操作系统交接。订阅本身就是这个信号（`DESKTOP_IPC.linksListen`，由 preload 发送一次），因此该回退不需要超时，也不需要确认。

**应用页面描述自己的右键菜单，shell 负责绘制。** `contextMenu.show(rows)`（`DESKTOP_IPC.appMenuShow`）依据经过校验的行弹出一个原生菜单，并以读者所选行的 id 结束，读者关闭菜单则为 null。`appMenuRows`（`apps/desktop/src/app-menu.ts`）拒绝空的、超出长度上限的、格式错误的、携带重复 id 的、或以没有可分隔内容的菜单分隔符分隔的列表。渲染进程对它负责的元素抑制平台自身的菜单，这正是"同时只有一份菜单"的原因：Electron 只对页面未阻止的点击发出 `context-menu` 事件（这一行为是在 Electron 44 上用一次探测实测的，因为平台文档并未说明）。

**两处界面使用该菜单，各自构造自己的行。** 在离开本应用的链接上右键，提供上述三个去处外加复制链接（ui-sidebar-browser）；在产物文件上右键，提供桌面为该文件登记的处理器、文件管理器，以及该文件的相对路径与绝对路径（ui-deliverables `src/client/file-menu.ts`）。两者都用自己那份有类型的字典构造行，因此文案仍归语言环境所有；在没有桌面 shell 的地方两者都不存在——既不拦截，也没有菜单。`MarkdownFileMentions.resolve` 为正文一侧新增了可选的 `menu`；产物文件的行则以 `openFileMenu` 注入接入同一个处理函数。

**产物文件的绝对路径在行已经知道工作区根的地方解析。** `resolveWorkspacePath(cwd, path)` 把模型写下的拼写转换为交接所需的 Host 路径，与行自身的打开器完全一致；应用列表在菜单打开时针对该文件查询，而不是缓存：桌面的处理器会在应用运行期间变化。

## Alternatives considered

**让 shell 掌管整条链接策略，并自己调用 `shell.openExternal`。** 这是最初的做法，而且更小：一个函数、两个调用点、不需要通往页面的回传通道。它失去了被驱动的 Chromium，而那正是这个应用的读者真正摆在面前的浏览器；它还会在客户端侧边栏浏览器之外，于 shell 中留下第二份"链接落在哪里"。现在地址被报告给页面，由页面掌管这个选择。

**从 Markdown 引擎的锚点处拦截点击。** `link.tsx` 可以 `preventDefault` 并直接调用桥接。这样只会覆盖助手正文，其他一概不覆盖——工具卡片、设置、文档面板以及媒体灯箱中的链接都经由别的代码渲染——而且会把桌面 shell 的知识塞进一个把其源码视为不可信的渲染引擎。浏览器插件中的文档级监听器用一条规则覆盖窗口内的每个锚点。

**保留 shell 的链接行，由渲染进程补上文件菜单。** shell 的 `context-menu` 处理函数已经依据 `ContextMenuParams` 构造模板，因此复制链接本可以留在那里。可是文件右键时便会有两份菜单同时出现：shell 自己的处理函数会对任何页面未阻止的点击触发，而渲染进程来不及阻止一份 shell 已经决定要显示的菜单。菜单只有一个归属，才使行集合完整。

**在渲染进程里绘制菜单，即 HTML 菜单。** Web 应用随处可以这么做，也不需要 IPC。它渲染在窗口内部，行为像页面元素而不像桌面其余部分：没有原生键盘导航、没有原生关闭，还会随页面缩放而缩放。菜单由 shell 绘制；只有行来自页面。

**像文件侧边栏那样列出全部应用。** 附件中的菜单只点名一个应用。把桌面上每个处理器做成子菜单是文件侧边栏的职责，因为那里的读者正在工作区内浏览；放在回复中，则是在读者与其点击的文件之间插入一列编辑器。

## Consequences

桌面窗口中的链接现在会在浏览器中打开，在链接上右键会在复制链接之外提供本应用拥有的两个浏览器。产物文件获得了右键菜单，却没有获得任何回复都不需要的应用列表。

shell 不再能作为唯一知道地址去向的一方：页面在监听时，窗口中的点击由客户端打开，因此由从未订阅的构建提供服务的 Host 会保留旧行为，而不是丢掉这次点击。代价是行的契约：菜单现在是一种很小的线格式（`DesktopMenuItem`），并在 shell 一侧校验；两处客户端界面都以结构化方式重述它，而不是导入 shell 的类型，因为客户端包不能导入桌面应用。

复制链接经由客户端自己的 `writeClipboard` 写出，代码块与读取块控件已经在用它；它优先使用异步 Clipboard API，并回退到 `execCommand`。shell 自己的菜单则为不描述菜单的页面（guest 页面与 shell 自己的窗口）保留其主进程剪贴板写入。

## Testing

`apps/desktop/tests/app-menu.spec.ts` 钉住行的校验：哪些被保留，以及每一种拒绝（空、超长、格式错误、重复 id、悬空分隔符）。`ui-sidebar-browser/tests/links.client.spec.ts` 覆盖客户端对哪些右键作出响应、三行各自通向何处、shell 报告的地址落入系统浏览器这一去处、关闭菜单、卸载，以及拒绝显示菜单的 shell。`ui-deliverables/tests/file-menu.client.spec.ts` 覆盖这些行、Host 交接、两种路径拼写、应用查询失败、被拒绝的交接，以及只在存在桌面 shell 时才读取桥接。`ui-primitives/tests/markdown.client.spec.tsx` 与 `ui-deliverables/tests/produced-files.client.spec.tsx` 覆盖提及与行的接线，包括在没有提供菜单的地方不拦截任何菜单。

这一切所依赖的右键抑制是实测而非假定：一次在 Electron 44 下的探测分别在调用了 `preventDefault` 的元素、普通元素与锚点上派发右键，主进程只对后两者收到了 `context-menu`。
