# Agent Note: 桌面端的 Web 界面上下文

Status: implemented

[English](2026-10-25-desktop-web-surface-context.md) | 中文

## 问题

桌面外壳会停用 `web-runtime` 行，因为它自己提供并打开 GUI，而这一行同时也注册了模型的界面上下文。因此桌面会话缺少 `app:web-surface` 段落，该段落说明回复以 Markdown 渲染，以及通过嵌入绝对本地路径来展示图片。一个被要求提供截图的桌面会话截取并查看了截图，回复中却一张也没有，随后改为在应用内浏览器中打开一个页面。

## 决策

`@aeven/web-app/surface` 负责界面上下文：`app:web-surface` 段落、`app:web-url` 运行时上下文、`AVN_WEB_URL` shell 变量，以及仅限开发者的 `harness:source` 段落。`web-app` 行在 `surfaceContext` 为 true 时挂载它，因此 `avn web` 保持不变；桌面补丁则把它作为自己的 `web-surface` 行插入，与被停用的 `web-runtime` 并列。桌面渲染器已经能在 `avn-app:` 页面上通过 `/api/file` 加载绝对本地图片路径。

## 考虑过的替代方案

**在桌面端重新启用 `web-runtime`** 还会挂载静态前端所有者、局域网信任、URL 行和浏览器移交，而这些都已由桌面外壳取代。**把该段落复制到桌面 Host** 会让同一段提示文本有两个所有者。

## 影响

桌面会话多出一个提示段落和 URL 运行时上下文，代价与 `avn web` 相同。段落文本把该界面称为 Aeven Web GUI，这正是桌面窗口所渲染的 GUI。Host 构建入口列表新增 `surface`，并且 `@aeven/desktop-host` 依赖 `@aeven/web-app` 以解析该行。
