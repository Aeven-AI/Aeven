# Agent Note：在网站或连接器上发布、发送和提交前先征求用户同意，并按站点提供会话授权

Status: implemented

[English](2026-11-13-public-sends-ask-first.md) | 中文

## 问题

两个会话未经询问就以用户身份发布了内容。其中一个会话里，用户先说「先别发」，又说「只填表」，代理却通过 `mcp__chrome_devtools__click` 点击了 GitHub 的 Create 按钮，随后又通过 GitHub 连接器的 `issue_write` 编辑并重新创建该 issue。另一个会话里，代理用 `evaluate_script` 调用填写备注并点击 Send 来发送 LinkedIn 邀请，还用 `fetch` POST 通过 LinkedIn 的消息 API 发出了一条私信。会话的审批策略是 `ask`，却没有任何询问：

- 浏览器工具没有发送闸门；只有上传、剪贴板、历史记录、书签、页面工具和清除会询问。
- `account-integrations` 拦截 Google、Microsoft、WhatsApp、Telegram、Discord 和 Slack 连接器的写操作，其他所有提供方（包括 GitHub 和自定义 MCP 服务器）都不经询问执行。
- `fillByTyping` 把含换行的值逐行以普通 Enter 键入，这会提交聊天框，并让 GitHub 的 markdown 编辑器续写列表，因此 issue 正文出现 `2. 2.` 和 `- - -`。

## 决策

- `@aeven/browser-chromium/src/send-gate.ts` 为每个浏览器界面判定类似发送的浏览器操作：点击标签为发布动词（英语、荷兰语、西班牙语、德语、法语、中文）的按钮类控件、点击闸门无法读取的目标、不带 Shift 的 Enter、含换行的键入文本，以及发送写入请求、或在源码含发布动词时执行点击、派发事件或提交的页面脚本。输入、填写、读取、导航以及本机页面从不询问。
- Chrome DevTools 工具由 `BrowserChromium` 中的 `tools/pre-execute` 监听器询问；`DevtoolsSendGate` 根据观察到的快照和页面列表结果重建 uid 到角色、标签和页面地址的映射。侧边栏 `preview_*` 工具在 `@aeven/tool-browser` 内部询问，通过 `read` 操作读取点击目标的起始标签。
- 新的 `SessionGrantCoverage` 值 `'site'` 按网站提供「本会话允许」。该授权只按范围（`site:<host>`）匹配，因此一次授权覆盖该站点上的所有浏览器工具；与 `'account'` 一样，`never` 策略下仍会询问。
- 没有自己只读清单的连接器提供方，在执行名称不表示读取（`get_*`、`list_*`、`search_*`、`*_read` 等）的工具前会询问，并按工具提供会话授权。`mail_send` 现在按账户提供会话授权。
- `fillByTyping` 让含换行的值走其键入路径，并在行间键入 `Shift+Enter`。

## 曾考虑的替代方案

- **在网站上的任何输入前按站点询问。** 用户否决：代理填写表单时给出的会话授权也会覆盖之后的提交，而这正是出错的情形。
- **在每个页面脚本前询问。** 已否决：大多数脚本只读取，因此第一次读取就会弹出询问，而在那里给出的会话授权会覆盖之后的发送。
- **在浏览器中拦截写入类 HTTP 请求。** 已否决：网站会以 POST 发送遥测和读取查询，因此每次页面加载都会询问。

## 影响

闸门按标签和脚本文本判定，而非意图。没有无障碍名称的纯图标发布控件会不经询问执行，而标签为清单动词的非发布按钮会询问；按站点的授权把后一种情况限制为每个站点每个会话一次询问。DevTools 闸门只知道在结果中见过的目标，因此 Host 重启后，网站上的点击会一直询问，直到模型获取新的快照。
