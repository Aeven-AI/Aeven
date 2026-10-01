# Agent Note: Browser surface status report

Status: implemented

[English](2026-10-01-browser-surface-status-report.md) | 中文

## Problem

`preview_status` 只回答会话旁的浏览器，别无其他。在 Web 部署中该浏览器就是右侧边栏面板，因此面板关闭时该工具以 `BROWSER_UNAVAILABLE` 失败，并指示去打开它。同一部署还挂载了 `@aeven/browser-chromium`：一个由 Host 启动的 Chrome，监听调试端口 9333，使用持久化 profile 且不带 `--enable-automation`，由同一批组合行挂载的 `chrome-devtools-mcp` 工具驱动。没有任何工具报告这个浏览器，因此持有它的会话被告知自己没有浏览器。

`web_fetch` 返回解码后的 HTTP(S) 文本，且不运行 JavaScript，因此在浏览器中自行构建内容的页面、或以拦截页应答非浏览器请求的页面，几乎不返回任何可用内容 —— 而该工具的描述与提示段落对此后该做什么只字未提。

2026-10-01，这两点共同造成了一次具体失败：研究那些拒绝机器人的页面时，模型读取状态工具，被告知不存在任何浏览器，于是向会话工作区安装了第二份 `playwright-core`。而 `@playwright/mcp` 早已是一行已挂载的组合行，其工具该会话此前已经调用过；`playwright` 也已作为 `packages/experimental/browser-overlay` 与 `packages/experimental/inspector` 的嵌套依赖存在两份。从仓库根目录做模块解析探测看不到其中任何一个，因为 npx 在工作区之外解析 MCP 服务器，而 pnpm 将包内依赖嵌套存放，所以它的沉默不能证明任何事。

## Decision

`preview_status` 报告组合交给该会话的每个界面，并且不再在面板关闭时失败。

`BrowserChromium.status(signal)` 在不启动浏览器的情况下采样 Host 的浏览器，返回调试端点、当前是否有浏览器在该端点应答、是否找到了可执行文件，以及驱动它的工具名前缀。它是一个公开的服务方法，而非 Typert Remote：它的消费者是 Host 侧的工具，不是 Client。

`tool-browser` 把 Client 的应答与该状态组合为一个 JSON 对象 —— `sessionTab`、`hostBrowser`、`nextStep` —— 并通过 `ctx.get` 读取 `browserChromium`，因此未挂载 Host 浏览器的组合依然能够应答。`nextStep` 优先会话旁的页面，其次是 Host 的 Chromium，两者皆无时说明需要向用户请求什么：这一顺序使面板中的浏览器在任何存在它的地方都是模型的默认选择，包括 Electron webview —— 在那里，用户登录过的页面才是承载该会话访问权限的界面。需要页面的调用仍然以 `BROWSER_UNAVAILABLE` 失败，并且现在会指明 `preview_status`。

第一步上下文与状态报告共用同一套有界查询，因此 [有界的浏览器状态查询](2026-09-24-bounded-browser-status-lookup.zh.md) 所决定的截止时间、对挂起请求的取消，以及 debug 与 warning 记录方式都保持不变。

面向模型的提示改为陈述升级路径，而不是禁止升级，并且给出顺序：无头优先，有窗口的浏览器最后。无头读取是免费的 —— 不会在用户的工作之上打开窗口，不占用他们自己浏览所用的 profile，上下文用完即可丢弃 —— 而已挂接的 Chrome 会打开可见窗口并占用该 profile，因此它应当由一次拒绝换来，而不是默认选中。唯一跳过该顺序的情形是需要用户会话的页面：自带 profile 的无头浏览器永远无法持有该登录态，所以只有已挂接的浏览器能服务它。第一步浏览器上下文承载该顺序，`web_fetch` 的提示段落把它陈述在不运行 JavaScript 的限制旁边。为什么以拒绝为触发条件是有实测依据的：2026-10-01 在同一个 Tripadvisor URL 上，`web_fetch` 返回 403，无头 Playwright 返回 403 且响应体为空，而用户 profile 上的已挂接 Chrome 返回 200 —— 这道墙是浏览器信任问题，只有他们真实的 profile 能解决。

## Alternatives considered

**只报告面板并保留失败。** 这是模型最不需要的做法：该消息对面板为真，对整台机器为假，而正是这句话让该会话去寻找一个可以安装的浏览器。一个无法报告正在运行的浏览器的状态工具，算不上状态工具。

**建立一个宣告所有后端的浏览器界面注册表。** 在阅读上游能力之后放弃。`deepseek-harness` 提供 `packages/browser-use/browser-use`，一个只做注册的服务（`ctx.browserUse`），其契约是由配置选定单一 provider，且 **模型不能在运行时切换已注册的后端**，其 provider 为 `browser-use-{chrome-devtools-mcp,playwright-mcp,stagehand-native}`，背后还有 `browser-use-runtime`。本分支走的是更早的路线 —— `tool-browser` 与 `browser-chromium` 加上原生的 `@aeven/mcp-client` 行 —— 其已合并的最新上游标签为 `dsh-v0.1.2-alpha.5`，而那项工作首次出现于 `dsh-v0.1.6-alpha.1`。因此，一份面向模型、可选择后端的清单既会重复上游已拥有的决定，又会与之矛盾，并且在下一次同步时还必须被拆除。

**在本次变更中实现安装审批强制执行。** 这次失败中更耐久的一半 —— 未经询问就改变环境的安装 —— 不在此处修复。它需要在包管理器变更上设置审批闸门，那是一项有独立机制的单独变更。

## Consequences

- 面板关闭但挂载了 Host 浏览器的会话会被告知这一事实，以及驱动它的工具前缀，而不再被告知不存在浏览器。
- `BrowserChromium.status` 不会作为副作用启动浏览器，因此状态调用永远不会打开用户未要求打开的窗口。
- 报告只列出会话旁的页面与 Host 的 Chromium，别无其他。任何进一步的后端在某个 provider 报告它之前对模型仍然不可见，而上游的 `browser-use` provider 正是这样做的。
- `packages/web/tool-browser/tests/tool-browser.spec.ts` 固定了四种状态报告情形：无任何界面、仅有 Host 浏览器、页面查询始终无应答时的 Host 浏览器，以及两种界面并存且优先面板。三十份记录了 `web_fetch` 段落文本的系统提示 fixture 随之更新；`docs/tool-catalog.md` 在本分支无法重新生成，因为 `scripts/gen-tool-catalog.ts` 拒绝了其启动清单中缺失的四个工具包（`tool-capability`、`tool-device`、`tool-memory`、`tool-search`），这与本次变更无关，并使目录中的 `web_fetch` 描述保持陈旧。
