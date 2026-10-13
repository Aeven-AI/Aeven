# Agent Note: Web 预加载页等待外壳数据

Status: implemented

[English](2026-09-08-web-preloader-waits-for-shell-data.md) | 中文

## 问题

在会话 URL 上重新加载时，静态外壳预加载页会在客户端插件树激活且 React 接管挂载点后立即隐藏。第一份 Workspace 列表、Session 列表与所选历史页仍在该交接之后到达，因此淡出会露出空侧边栏（「暂无会话」）和空白会话栏。[静态 Web 外壳预加载页](2026-09-02-static-web-shell-preloader.zh.md)已经覆盖 JavaScript 前的首帧，但不覆盖这第一份 Remote 载荷。

## 决策

`AppWebEntry` 仍在每个客户端 entry 进入 ACTIVE 后挂载应用，然后在淡出 `#avn-preloader` 之前等待 `ctx.uiWorkspace.whenInitialDataReady()`。该等待在两个列表投影都离开 `pending`（Workspace stream 失败也算到达）、初始 URL 或最近 Workspace 导航完成、且所选 Session 的 `openState` 为 `open` 或 `error` 时结束。没有所选 Session 就是就绪的空外壳。后续导航不会恢复 overlay。没有 `uiWorkspace` 的组合仍在挂载后立即淡出。认证屏幕与启动失败仍立即隐藏。该等待还会在插件销毁时结束，使 boot 不会在拆卸后挂起。

等待只覆盖第一份列表基线与所选历史页。更早历史的分页、图片以及随后的 catalog 刷新不在关键路径上。Boot 在等待结束后再让出一个 macrotask，使已挂载的外壳能在 400ms 淡出开始前提交该载荷。

## 验证

Workspace 单元测试覆盖就绪的空外壳、打开或失败的所选 Session、稍后出现的 Session face、Workspace stream 失败、初始连接路径以及销毁。Boot 单元测试会让静态元素保持可见直到 `whenInitialDataReady` 结束，并在服务缺失或不等待时立即淡出。

## 考虑过的替代方案

**在 ConversationRoot 或 AppFrame 于 React 提交后再隐藏。** 这会把无框架 overlay 绑到特定 slot 树，并且没有这些占用方的组合会卡住预加载页，除非 boot 仍拥有回退。

**像最初的预加载页决策那样，只等待插件激活。** 这正是缺陷：harness 就绪早于侧边栏与内容就绪。

**在载荷到达之前阻止挂载。** 应用在等待结束前不会订阅或开始打开历史，从而增加一段串行延迟；当前顺序（先挂载，再等待已经在拉取的 store）可以避免这一点。

## 后果

首次列表或历史往返较慢时，品牌 overlay 会继续挡住页面，而不是闪出空 chrome。永远不到达的首次拉取会把 overlay 留到销毁。Worker preview 以及不含 `#avn-preloader` 的 document 保持不变。[静态预加载页注记](2026-09-02-static-web-shell-preloader.zh.md)仍拥有首帧标记与 CSS；本注记拥有成功 Web 启动何时关闭该视觉。
