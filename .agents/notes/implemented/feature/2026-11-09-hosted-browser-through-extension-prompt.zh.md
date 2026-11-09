# Agent Note：托管版 Aeven 请求安装扩展，并在用户的浏览器中打开网站

Status: implemented

[English](2026-11-09-hosted-browser-through-extension-prompt.md) | 中文

## 问题

托管版 Aeven 关闭了 Host 的 Chromium，因此通过 [Aeven 扩展](../../../../apps/chrome-extension/README.zh.md) 到达的用户自己的浏览器，是托管会话唯一的浏览器。网页此前只处理扩展标签页命令，其他一概不应答：`preview_status` 让模型请用户从右侧栏打开浏览器，`preview_navigate`（“打开 linkedin”）无处可开，扩展缺失也只以错误的形式到达模型，用户什么也看不到。

## 决定

[`@aeven/client-ui-sidebar-browser`](../../../../packages/client/ui-sidebar-browser/README.zh.md) 的网页代表用户的浏览器应答（[`index.ts`](../../../../packages/client/ui-sidebar-browser/src/client/index.ts) 的 `installPageExtension`）。

- **状态。** 没有当前扩展标签页时，status 应答 `{ open: false, openable: true, opensIn: 'user-browser' }`；在无法安装 Chrome 应用商店扩展的浏览器中（没有 Chromium 客户端提示，或是移动端提示）应答 `{ open: false, openable: false, unavailable: 'browser-unsupported' }`。[`@aeven/tool-browser`](../../../../packages/web/tool-browser/README.zh.md) 为每种应答生成各自的 `nextStep`。
- **导航。** 没有当前扩展标签页，或用户已关闭它时，导航会按该地址打开一个新的扩展标签页并将其设为当前标签页。
- **安装提示。** 每个需要扩展的请求都先等待 [`ExtensionPrompt.require`](../../../../packages/client/ui-sidebar-browser/src/client/extension-install.ts)。扩展缺失时，Aeven 的标准模态框会链接 Chrome 应用商店页面，请求保持等待，页面每秒检查一次，并在用户回到该标签页时检查。Chrome 156 在扩展安装后立即向已打开的 `aeven.io` 页面暴露 `chrome.runtime`，因此请求无需重新加载即可继续。**暂不** 会使请求失败，并指示模型本轮不要再次请求。等待在工具截止时间前 5 秒结束，因此模型收到的是结束本轮的指示而不是 `TOOL_TIMEOUT`；模态框保持打开，此后完成的安装会提供 **继续**，向该会话发送一条消息。不受支持的浏览器会看到列出受支持浏览器与桌面版下载的模态框，请求立即失败。
- **历史记录。** 页面的每个 status 应答都带有 `surface: 'user-browser'`。`preview_history` 随即把搜索视为 `source: browser`，因此审批写明的是用户的浏览器；页面对任何 source 都读取该浏览器的历史记录，因为页面旁没有聊天旁的浏览器。
- **设置。** 扩展未连接时，网页的扩展行会提供商店页面，其说明也写明只有桌面应用会自行启动浏览器。

## 考虑过的替代方案

在页面加载时检查扩展被否决：大多数轮次不需要浏览器，公开页面用 `web_fetch` 读取即可。没有选择聊天内联卡片，因为提示必须在工具调用返回之前就存在，而提问卡片既不能链接商店页面，也无法发现安装。立即让调用失败并请用户重试被否决，因为页面在打开期间就能发现安装。打开单独的浏览器窗口需要发布新的扩展版本并再次接受商店审核；扩展的标签页仍留在用户的窗口中，位于其 Aeven 标签组里。

## 后果

工具的 `actionTimeoutMs` 限定了调用等待期间用户完成安装的时间；超过之后，继续需要点 **继续** 按钮或回复。**继续** 消息是页面写下的用户消息，会话也将其作为用户消息记录。首步浏览器上下文仍把当前扩展标签页称为“聊天旁打开的应用内浏览器”，与桌面端现有行为一致。

## 验证

在全新的 Chrome 156 配置文件中打开 `https://aeven.io/`，安装前 `chrome.runtime` 为 undefined；`Extensions.loadUnpacked` 之后，扩展立即在同一页面上应答 `hello`，无需重新加载。在该页面上，`tabs.create` 在 Aeven 标签页中打开了 `https://example.com`，`operate` 读取了它的状态与文本。在本地运行的托管配置中，移除扩展后请求打开网站，提示在 3 秒内出现；3 秒后安装扩展，提示在一秒内关闭，同一个 `preview_navigate` 调用返回了打开的标签页，随后 Agent 读取了页面。关闭提示会使调用以拒绝失败。使用 Android 客户端提示且没有扩展时，调用立即失败并显示不受支持浏览器的模态框。历史记录搜索请求的是“通过 Aeven 扩展搜索你的浏览器的历史记录”，获准后找到了 Agent 先前打开的文章。两个包的 `tsc` 均通过，`pnpm run build` 成功。
