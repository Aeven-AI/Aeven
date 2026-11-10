# Agent Note：Aeven Web 上的“浏览器”启动项通过扩展打开读者的浏览器

Status: implemented

[English](2026-11-10-web-browser-launcher-uses-extension.md) | 中文

## 问题

2026-11-10，在 Android 版 Chrome 中点按 chat.aeven.io 右侧栏的“浏览器”没有任何反应。`packages/client/ui-sidebar-browser/src/client/index.ts` 只有在 Host 提供 `remote.browserChromium` 时才注册网页的“浏览器”启动项，而且它只会打开 Host 的 Chromium。托管 bundle 禁用了 Host 浏览器，因此在 Aeven Web 上，无论什么设备都没有注册这个启动项，而扩展的安装模态框和不支持浏览器的模态框只能通过智能体的工具调用到达。

## 决策

只要侧栏存在，网页启动项就会注册。有自己 Chromium 的 Host 仍然打开它；没有时，启动项通过 Aeven 扩展在读者自己的浏览器中打开新标签页，使用与工具调用相同的等待流程。无法运行扩展的浏览器（例如 Android 版 Chrome）会看到不支持该浏览器的模态框，缺少扩展时会看到安装模态框，已安装扩展时则打开标签页。

## 考虑过的替代方案

在没有 Host Chromium 的 Aeven Web 上隐藏“浏览器”，会去掉读者唯一能看到浏览器为何不可用的地方，而通过扩展的路径正是 Aeven Web 使用的浏览器。

## 影响

Aeven Web 上的“浏览器”总会有回应：一个标签页、安装模态框或不支持该浏览器的模态框。拒绝安装只会留下一条控制台警告，因为模态框已经说明了结果。

## 验证

ui-sidebar-browser 和 ui-sidebar-select 的测试通过（18 个）；类型检查和 lint 无问题。
