# Agent Note：桌面窗口未显示的对话的浏览器请求，以及缺少扩展时的统一提示

Status: implemented

[English](2026-11-19-browser-for-chats-the-desktop-window-does-not-show.md) | 中文

## 问题

2026-11-19，所有者在一个运行于其桌面的对话中（会话 `08b945fd`）让 Aeven Web「打开 linkedin.com」。审批和提问通过交互中继到达 Aeven Web，但 `browser/automation` 不经中继，因此只有桌面窗口收到请求。该窗口对每个会话（包括它没有显示的会话）都以 `{ open: false, openable: true }` 应答 status，于是模型调用 `preview_navigate`，而 `navigateClosed` 一直等待一个在该窗口中永远无法挂载的面板，直到 60 s 后调用以 `TOOL_TIMEOUT` 结束。直到所有者说「用扩展」，模型才使用扩展。

另外，没有扩展的网页会显示两个不同的模态框：Agent 的请求显示扩展安装模态框，其中没有桌面版；托管 Aeven 上侧栏的浏览器启动器显示桌面交接模态框，其中没有扩展。

## 决定

- **桌面窗口。** 在 [`index.ts`](../../../../packages/client/ui-sidebar-browser/src/client/index.ts) 中，面板只为窗口显示的会话应答 status 和导航。对其他任何会话，status 应答 `opensIn: 'user-browser'`，导航则通过桌面桥接经扩展在读者的浏览器中打开新标签页。
- **统一提示。** 扩展安装模态框还提供 **在 Æven 桌面版中打开**（跳转 `aeven://c/<session>`）和 **下载 Æven 桌面版**。跳转链接后 1.5 s 内页面失去焦点时，[`ExtensionPrompt.openedDesktop`](../../../../packages/client/ui-sidebar-browser/src/client/extension-install.ts) 使等待中的调用失败，并指示模型结束本轮；否则模态框保持打开并建议下载。两个主按钮是桌面版和扩展。关闭按钮表示拒绝，**暂不** 已移除。
- **启动器。** 网页启动器不再以 `browser` 原因发出 `desktop-handoff/request`；缺少扩展时显示安装模态框，因此该包不再依赖 `@aeven/client-ui-desktop-handoff`。

## 考虑过的替代方案

像中继审批那样把 `browser/automation` 中继到 Aeven Web，可以让读者面前的页面应答，但每个浏览器动作（包括截图）都要经过中继。已向所有者提出，尚未实现。

## 影响

桌面窗口依据其当前会话作出判断，因为 Host 不记录消息来自哪台设备。桌面窗口恰好显示的对话仍在其面板中打开；当 Aeven Web 运行在另一台电脑上时，扩展标签页会在桌面电脑的浏览器中打开。

## 验证

该包的 `tsc` 通过，`pnpm run build:client` 成功。在本地网页客户端上，安装模态框显示三个操作，桌面版和扩展按钮为主按钮。
