---
description: "面向模型的 preview_* 浏览器工具与第一步页面上下文：部署如何挂载它们、限定其等待，以及模型看到的内容。"
kind: "package-reference"
---

# @aeven/tool-browser

[English](README.md) | 中文

## 概述

`@aeven/tool-browser` 让模型读取并操作用户在会话旁看到的浏览器。它注册三十个 `preview_*` 工具，并在每轮的第一步把当前打开的页面作为一条记录在日志中的插件消息加入请求。插件本身不执行任何浏览器操作：每次调用都是一个 `browser/automation` waterfall，由持有该会话浏览器的 Client 应答；`preview_status` 例外，它同时报告 Host 运行的 Chromium。对该 waterfall 的每次等待都有上限，因此轮次永远不会等待一个没有任何已连接 Client 持有的浏览器。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

在其 Client 能够承载浏览器的代理组合中挂载本插件，例如 `@aeven/client-ui-sidebar-browser` 的右侧边栏浏览器。随附的 `cordis`、`standard` 与 `ptc` 预设都会挂载它。

`preview_upload` 接受 Electron 所在计算机上的绝对路径，以及文件输入框或上传按钮的选择器；省略选择器时页面必须恰好有一个文件输入框。远程上传会请求以目标源和路径为范围的审批，localhost 除外。`preview_sequence` 在本地运行 1–20 个类型化操作，按条件等待，并返回第一个失败。上传和序列执行需要写权限。这些操作为 Electron 实现；嵌入框架中的上传选择器不受支持。

`preview_snapshot` 接受 `mode: dom`（默认）或 `mode: ax`。无障碍模式读取 Chromium 的无障碍树，包括 shadow DOM，并返回 `snapshotId`、带索引的 `nodes` 和 `truncated`。节点采用桌面元素字段 `index`、`token`、`role`、`title`、`value` 和 `editable`。将返回的令牌传给 `preview_click` 或 `preview_type`，代替选择器。令牌在下一次观察或浏览器操作时过期；导航后以及目标已分离、隐藏或禁用时会拒绝操作。操作后重新观察；框架内的无障碍目标不属于本阶段。

`preview_screenshot` 在 `actionTimeoutMs` 内将可见视口捕获为 JPEG，并把它存为工具结果中的持久图像附件。截图经普通图像结果路径进入会话日志和模型历史；此工具需要附件存储。

每个 `selector` 参数都接受 CSS 或定位器片段：`text=`、带 `name`、`checked`、`disabled`、`expanded`、`pressed`、`selected` 和 `level` 过滤的 `role=`、`label=`、`placeholder=`、`alt=`、`title=`、`testid=` 以及 `xpath=`；`>>` 在前一个匹配内部继续查找，`nth=` 和 `visible=` 过滤匹配。匹配多个元素的选择器会被拒绝。`frame` 参数指明目标所在的 iframe。[浏览器引擎](../browser-engine/README.zh.md)负责定位器语义。

| 工具 | 作用 |
| --- | --- |
| `preview_click` | 单击、双击（`clickCount`）、右键或中键单击（`button`），可带修饰键。点击触发的导航加载完成后返回，若点击打开了对话框则立即连同该对话框返回。 |
| `preview_hover`、`preview_drag` | 把指针移到目标上；在两个目标之间按下、移动并松开。 |
| `preview_select`、`preview_check` | 按值或标签选择 `<select>` 选项；设置复选框、单选框或 `aria-checked` 控件，仅在状态不同时点击。 |
| `preview_read`、`preview_wait` | 读取一个或全部匹配的文本、HTML、值、属性、数量、可见性、启用或选中状态或边框；等待元素状态、地址或加载状态。 |
| `preview_content` | 以 markdown、纯文本或 HTML 返回页面，或返回已打开 YouTube 视频的字幕，超过 100,000 个字符时截断。 |
| `preview_export_document` | 用访客会话的 cookie 把打开的 Google Docs、Sheets 或 Slides 文档下载到用户的“下载”文件夹；文本格式还会返回其内容。 |
| `preview_clipboard`、`preview_console`、`preview_dialog` | 读取（需审批）或写入剪贴板文本；页面最近 500 条控制台记录和未捕获的异常；查看或应答 JavaScript 对话框。 |
| `preview_browser_control` | 用指针按下窗格自己的工具栏和三点菜单：截图、在 Chrome 中打开、强制重新加载、DevTools、缩放、外观，以及清除缓存或 cookie（需审批）。 |
| `preview_tabs` | 列出、打开、显示或关闭会话的浏览器标签页；每个标签页是侧边栏中的一个 Browser 胶囊，其他工具作用于当前标签页。指针会按下胶囊、加号菜单或胶囊的关闭按钮。`browser` 在 Aeven 的 Chrome、用户的 Chrome，或通过 Aeven 扩展在用户的某个浏览器中打开标签页（`browserName` 选择哪一个）。 |
| `preview_history`、`preview_bookmarks` | 按地址或标题中的词搜索应用内浏览器访问过的页面，或在 `source` 为 browser 时通过 Aeven 扩展搜索用户浏览器的历史记录；通过扩展搜索用户的书签（需审批，在会话内记住）。 |
| `preview_page_tools` | 列出打开的页面通过 `document.modelContext` 注册的 WebMCP 工具，或调用其中一个（按站点和工具审批）。 |
| `preview_handoff` | 向用户显示一个模态框，写明一个应由用户完成的浏览器步骤，然后让模型结束本轮；没有窗格时由聊天提出同样的问题。 |

指针操作遵循 ChatGPT 浏览器代理的时序：绘制的光标先到达（最多 1500 ms），然后才发送页面的鼠标移动和按下；点击最多等待 3000 ms，等待在操作后 250 ms 内开始的导航；后退、前进、重新加载和强制重新加载最多等待 10,000 ms，等待在 250 ms 内开始的加载；拖动只在第一个点等待光标；滚动在光标到达后发送一次滚轮事件，并在滚动位置稳定后返回。

### 配置

两个字段均为可选；无效值会使插件加载失败。

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `statusTimeoutMs` | `2000` | 每轮第一步等待当前页面的毫秒数，也是 `preview_status` 等待 Client 的毫秒数。超时后，本步不带浏览器上下文继续，状态报告中不含页面。 |
| `actionTimeoutMs` | `60000` | 每个 `preview_*` 调用等待的毫秒数，声明为该工具的 `timeoutMs`。由 `@aeven/tool-call-timeout-policy` 执行，模型收到 `TOOL_TIMEOUT`。 |

```yaml
- id: tool-browser
  name: '@aeven/tool-browser'
  config:
    statusTimeoutMs: 2000
    actionTimeoutMs: 60000
```

<a id="understand-the-implementation"></a>
## 理解实现

在 Web 组合中，`@aeven/api-remotes` 把 `browser/automation` 转发给 Typert 网关，网关把它投递给每个已连接的 Client，并且只有在每个投递都得到应答后才结算。挂起的转发 waterfall 没有截止时间，因为审批和用户提问必须送达稍后连接的 Client。因此插件自行限定等待：每次查询都在与轮次或调用 signal 合并的 `deadline` 下运行，把有界 signal 放入请求以便网关取消挂起的事件，并让 waterfall 与该 signal 竞速，因为监听器没有义务遵守它。第一步中未获应答的查询以 debug 级别记录；监听器失败以 warning 记录。[有界的浏览器状态查询](../../../.agents/notes/implemented/bug-fix/2026-09-24-bounded-browser-status-lookup.zh.md) Agent Note 记录了这一决定。

`preview_status` 无需页面即可应答。它把 Client 的应答与 `@aeven/browser-chromium` 的 `browserChromium` 服务状态组合起来 —— 通过 `ctx.get` 读取，因此未挂载 Host 浏览器的组合依然能够应答 —— 并报告该会话可以驱动的每个界面。需要页面的调用以 `BROWSER_UNAVAILABLE` 失败，并附带打开浏览器、或询问 `preview_status` 该会话有哪些界面的指示；没有调用方代理的调用以 `BROWSER_NO_AGENT` 失败。

`preview_navigate` 拒绝本机提供的地址 —— `localhost`、其子域名、`[::1]`、`0.0.0.0` 以及任何回环 IPv4 地址 —— 只要 Host 的 Chrome DevTools 工具已注册，且用户本人的请求没有点名该地址。该调用以 `BROWSER_DEVELOPMENT_TARGET` 失败，并指明应当改用的 `new_page` 调用，因此模型永远不会把侧边栏窗格导航到它正在构建的页面。用户要求查看某个本机地址时，它就在窗格里打开：最新的用户消息只要带有该地址、其主机名或其端口，就算点名了它。Chrome DevTools 工具缺席的部署仍把窗格当作唯一的可见浏览器，那里不会触发该拒绝。

## Model Experience

### 第一步浏览器上下文

#### What the model sees

在一轮的第一步，当浏览器应答的页面地址不是 `about:blank` 时，插件追加一条插件用户消息，写明页面标题和地址，其后是固定的说明。浏览器未在 `statusTimeoutMs` 内应答或页面为空白时，不添加任何内容。

##### 浏览器上下文消息

```markdown
The user has the in-app browser open beside this chat, showing: <title> — <url>

This browser is the collaborative browser shared with the user. Prefer the preview_* tools for browser navigation, inspection, and interaction on it.
Task routing: a request to open, visit, or read a website is this pane's ("open linkedin") — open it here and keep the task here. Development and debugging belong to the Chrome DevTools browser (mcp__chrome_devtools__*): a localhost or 127.0.0.1 page, and any task that changes the code behind a page. Never open a local dev server in this pane to check your own work, and never switch surfaces merely because an interaction failed.
Use preview_sequence for known consecutive actions; it runs locally in order and waits for specified elements without another model request between actions. Use preview_upload to attach files directly; never use clipboard tricks, a local HTTP server, or a native picker for a supported upload.
For browser work, first call preview_status. Then use preview_navigate, preview_snapshot, and the focused interaction tools. Prefer snapshot-provided selectors over coordinates.
A page served from this machine (localhost or 127.0.0.1) is an application under development: open it in the Chrome DevTools browser (mcp__chrome_devtools__*), not this pane. Use the headless browser tools for it only when that browser and this pane are both unavailable, and say that the check ran in a headless copy.
Correct an actionable error in this browser. If this browser needs authentication, a captcha, or the user's confirmation, call preview_handoff and end your turn; never type credentials or switch browsers to bypass sign-in. Prefer preview_snapshot and focused actions over writing JavaScript for ordinary clicks or text entry; read a whole article with preview_content.
```

#### Token effect

页面打开时每轮一次，约 400 个 token 加上标题和地址；没有打开页面或查询超时时为零。

#### KV Cache effect

仅追加：该消息在轮次开始时作为 `user/message` 记录，因此之前的请求 token 保持不变。

### 状态报告

#### What the model sees

`preview_status` 以一个 JSON 对象应答，并且不会因浏览器缺失而失败。`sessionTab` 是会话旁的浏览器当前显示的页面，或为 null。`hostBrowser` 是本 Host 运行的 Chromium —— 其调试端点、是否已有浏览器在该端点应答、是否找到了可执行文件，以及驱动它的工具名前缀 —— 当组合未挂载任何 Host 浏览器时为 null。当本会话注册的工具中没有任何一个带有该前缀时，`hostBrowser.toolsUnavailable` 依据 MCP 服务器的 `mcp/servers` 报告（其状态、最近一次错误以及 `tool_search` 重启查询）说明原因，`nextStep` 也会说明这些工具未在服务，而不是让模型去调用它们。`nextStep` 指明应当驱动什么：只访问站点的任务用会话旁的页面，开发与调试以及任何 `localhost` 页面用 Chrome DevTools，没有打开页面时用 Host 的 Chromium，两者皆无时说明需要向用户请求什么。被 `web_fetch` 拒绝的页面正是这份报告存在的理由：会话旁的浏览器此时不可用，而 Host 的 Chromium 仍然可达。 在 Aeven 网页上，Client 代表通过 Aeven 扩展到达的用户自己的浏览器应答。没有当前扩展标签页时，`nextStep` 告诉模型：`preview_navigate` 会在用户浏览器的新标签页中打开该地址，用户在那里保持登录；扩展缺失时会向用户提供安装，调用在此期间等待。无法运行扩展的浏览器会使 `nextStep` 说明没有可用的浏览器，用户可改用 Chrome、Edge、Brave 或桌面版。等待扩展的调用会在用户拒绝、其浏览器无法运行扩展，或 `actionTimeoutMs` 到期前 5 秒时失败，并指示模型结束本轮。这类页面的每个 status 应答都带有 `surface: 'user-browser'`，此时无论模型传入哪个 `source`，`preview_history` 都搜索用户的浏览器，因为会话旁没有可供搜索的浏览器。

#### Token effect

约 110 个 token，每次调用一次，而非每个请求一次。

#### KV Cache effect

无：工具结果追加在工具调用结束上一请求的位置。

### 工具 schema

#### What the model sees

模型看到生成的 [`preview_*` schema](../../../docs/tool-catalog.zh.md#aeventool-browser)。等待预算是部署设置，不是模型参数。

#### Token effect

工具可见时每个请求固定。

#### KV Cache effect

在可见工具集不变时前缀稳定。

## Known Limitations and Deferred Work

- **在 `statusTimeoutMs` 之后才应答的 Client 在该轮被忽略** —— 模型直到下一轮第一步才得知当前打开的页面。
- **没有已连接的 Client 时，每个新轮次都要等待 `statusTimeoutMs`** —— 网关无法告知插件没有 Client 连接，因此查询会在第一步之前等满其截止时间。
- **没有任何插件报告过的浏览器界面仍然不可见** —— 该报告只列出会话旁的页面与 Host 的 Chromium，因此组合挂载的其他自动化后端，只有在某个插件报告它之后才会被告知模型。
- **JavaScript `prompt()` 永远到不了代理** —— Electron 在页面或调试器看到对话框之前就以 null 应答它，因此只有 `alert`、`confirm` 和 `beforeunload` 可以用 `preview_dialog` 应答。
- **用户自己的历史记录和书签需要 Aeven 扩展** —— 没有扩展时只搜索保存在桌面窗口存储中的应用内浏览器历史；从不读取用户打开的标签页。
- **WebMCP 需要 Chromium 的 `WebMCP` 功能** —— 桌面外壳在启动时启用它；只通过其他脚本 API 提供工具的页面不会被列出。
- **无 invariant 伴随模块**——不发布运行时 invariant 伴随模块，因为本包自己的 spec 已经逐一验证了它拥有的关系：针对桩 waterfall 的第一步查询、`statusTimeoutMs` 与 `actionTimeoutMs` 之下的有界等待，以及状态报告中的界面选择。

<a id="开发备注"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
