# Agent Note: 侧边栏浏览器的命令与指针时序达到 ChatGPT 水平

Status: implemented

[English](2026-11-08-sidebar-browser-chatgpt-parity.md) | 中文

## 问题

侧边栏浏览器的代理只有十四个 `preview_*` 工具：没有悬停、拖动、选择、勾选或读取；没有 JavaScript 对话框、iframe、控制台或内容导出；也无法按下窗格自己的工具栏，或把一个步骤交给用户。它的指针移植自 ChatGPT 的浏览器代理光标，但求解器和帧时序与原版不同，操作也不像 ChatGPT 那样等待：点击在它触发的导航之前就返回，滚动运行脚本而不是发送输入。

## 决策

这些工具遵循 ChatGPT Chrome 扩展（版本 1.26.1102.11740）的命令集和时序，重新实现，而非复制。

- **引擎。** [`@aeven/browser-engine`](../../../../packages/web/browser-engine/README.zh.md) 新增悬停、拖动、选择、勾选、读取、内容（markdown、纯文本、html、YouTube 字幕）、Google Docs 导出、剪贴板、控制台和对话框操作。每个选择器都接受 Playwright 风格的定位器（[`page-scripts.ts`](../../../../packages/web/browser-engine/src/page-scripts.ts)），多个匹配时严格拒绝，`frame` 参数在该 iframe 的隔离环境中求值。引擎既不导入 Electron 也不导入 Node，因此侧边栏浏览器、经 CDP 的 Chrome 和扩展运行同一份代码。
- **时序。** 指针操作最多等待 1500 ms 让绘制的光标到达，然后移动鼠标并按下；点击观察 250 ms 内是否开始导航，并最多等待 3000 ms 让其加载；后退、前进和重新加载最多等待 10 s；拖动只在第一个点等待光标。这些都是 ChatGPT 的取值。
- **滚动。** 光标到达后发送一次滚轮事件。Electron guest 会确认 ChatGPT 默认使用的 `Input.synthesizeScrollGesture`，但并不滚动；滚轮是 ChatGPT 的另一种滚动方式。
- **对话框。** 打开对话框的操作会连同对话框返回，而不是阻塞。调用 `Page.handleJavaScriptDialog` 之后，引擎在 guest 上触发 Electron 的 `-cancel-dialogs`，否则 Electron 自己的消息框会留在屏幕上。
- **窗格控件。** `preview_browser_control` 通过窗格的 `pressControl` 用指针按下工具栏和三点菜单；`pressControl` 会等待通过 portal 渲染的菜单行就位后再瞄准。清除 cookie 或缓存以及读取剪贴板需要审批。
- **标签页。** 侧边栏中的每个 Browser 胶囊都是一个拥有自己 guest 的标签页；会话的当前标签页是最后显示的那个，代理操作作用于它（[`guest.ts`](../../../../packages/client/ui-sidebar-browser/src/client/guest.ts) 中的 `LiveGuests`）。`preview_tabs` 用指针按下胶囊、加号菜单中的 Browser 行或胶囊的关闭按钮，指针图层覆盖整个侧边栏列。胶囊保留 Browser 标签。
- **历史记录。** 已提交的页面保存在窗口存储中（[`history.ts`](../../../../packages/client/ui-sidebar-browser/src/client/history.ts)），排在地址栏现有建议之前，审批后可通过 `preview_history` 搜索。没有新增 UI。
- **WebMCP。** 桌面外壳启用 Chromium 的 `WebMCP` 功能；`preview_page_tools` 列出 `document.modelContext.getTools()` 并运行 `executeTool`，与 ChatGPT 扩展一致，按站点和工具审批。
- **交接。** `preview_handoff` 在窗口上显示 Aeven 的标准模态框（侧边栏可能遮住对话），带“确定”和“暂不”，并让模型结束本轮。
- **你的浏览器。** [Aeven 扩展](../../../../apps/chrome-extension/README.zh.md)通过 `chrome.debugger` 在自己的标签页中运行完整的引擎操作，这些标签页放在一个展开的 Aeven 标签组中；代理在某个标签页最后一次操作 10 s 后，扩展会从该标签页分离，因此 Chrome 的调试提示条不会一直显示。桌面应用通过原生消息主机连接扩展，并为每个浏览器安装保留一个连接，因此可以同时连接多个浏览器；没有连接时，它会启动装有扩展的浏览器。托管版 Aeven 从网页通过 `externally_connectable` 连接扩展。审批后会从每个已连接的浏览器读取历史记录和书签。
- **光标。** 覆盖层的弹簧求解器在停顿后从落后一个 60 Hz 帧的位置重新开始，吸附时保留剩余速度；每帧至少推进 1/60 秒，长距离移动的第一帧恰好推进这么多；隐藏的指针在目标处重新出现；光晕为 `#339cff`。这些都是参考实现的取值。

## 曾考虑的替代方案

复制扩展的代码被否决：它是专有代码。曾提出过一个基于相同命令的 ChatGPT 式单一脚本工具，但没有采用；保留独立的 `preview_*` 工具。停靠在窗格内的交接卡片被否决，改用标准模态框。

## 后果

Electron 以 null 应答 `prompt()`，因此只有 alert、confirm 和 beforeunload 会到达 `preview_dialog`。没有扩展时不读取用户自己的历史记录和书签。当桌面应用和网页登录同一个 Host 时，二者都可能应答同一会话的标签页命令。Electron 的 `-cancel-dialogs` 事件属于 Electron 内部实现，每次升级 Electron 时都要重新确认。

## 验证

类型检查和 `pnpm run build` 通过。spec 覆盖扩展连接注册表、浏览器检测，以及网页到扩展的连接。在 `dev:desktop` 中，通过外壳桥接和真实的代理轮次验证了：定位器、勾选、选择、悬停、iframe 读取、markdown 内容、滑块拖动、控制台、等待、滚动（先 900 px 再 −400 px，分别停在 900 和 500）、alert 和 confirm 应答后没有残留的提示框、通过指针缩放和切换外观、交接模态框、由指针打开、切换和关闭标签页、列出并调用页面的 WebMCP 工具，以及从桌面应用和网页应用通过扩展在 Chrome 中打开、读取和点击。
