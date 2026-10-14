# Agent Note: Linux 桌面端自绘标题栏条

Status: implemented

[English](2026-10-14-linux-desktop-caption-strip.md) | 中文

## 问题

在 Linux 上，桌面外壳保留标准 GTK 窗口框架。GNOME 原生菜单栏及其主题的圆形标题栏按钮以 GTK 主题颜色显示在页面上方，页面无法设置这些颜色：Electron 不提供菜单栏颜色，而 Linux 上的 `titleBarOverlay` 无论收到怎样的叠加层 `color` 与 `symbolColor`，都会绘制主题自带的按钮。

## 决定

- **Linux 窗口无框架，并复用 Windows 的标题栏条。** `apps/desktop/src/main.ts` 中的 `createWindow` 在 Linux 上传入 `frame: false`。preload（`apps/desktop/src/preload-app.ts`）安装与 Windows 相同的 32 px 标题栏条和页面绘制的菜单栏，并在 Linux 上于该条右端的 shadow root 中添加最小化、最大化与关闭按钮。
- **按钮通过一个 IPC 通道执行操作。** 每个按钮以 `DesktopCaptionAction` 发送 `avn-desktop:caption-window-control`；主进程仅在 Linux 上、且仅接受来自主窗口主 frame 的请求，`maximize` 为切换。按钮的无障碍名称与提示文字通过 `avn-desktop:caption-button-labels` 取自外壳 locale（`minimizeWindow`、`maximizeWindow`、`closeWindow`）。
- **浅色方案下标题栏条为 `#f2f2f2`。** 配色上报器在根元素上写入 `data-avn-caption-scheme`，Windows 与 Linux 上的标题栏条样式据此绘制 `#f2f2f2`；深色方案沿用 body 背景，按钮图形跟随配色方案。Windows 仍在透明叠加层上使用原生标题栏按钮。

## 考虑过的替代方案

**自动隐藏原生菜单栏。** 一行 `autoHideMenuBar` 即可去掉白色菜单栏，但 GNOME 标题栏与按钮仍以主题颜色位于页面上方，标题栏条无法与页面一致。

**像 Windows 一样在 Linux 上使用 `titleBarOverlay`。** 它会隐藏框架与菜单栏，但 Electron 绘制 GTK 主题的标题栏按钮，在 Yaru 上无论叠加层颜色如何，都是灰色圆形。

## 影响

- Linux 失去窗口管理器装饰：页面绘制的标题栏条负责拖动（`-webkit-app-region: drag`）与三个窗口操作，此外的窗口管理器行为（例如边缘缩放）取决于 Electron 在会话合成器上的无框架窗口支持。
- Linux 与 Windows 共享同一标题栏条与菜单栏；Linux 另外带有三个按钮、两个 IPC 通道与三个 locale 键。
- 浅色标题栏条固定为 `#f2f2f2` 而非 body 背景，因此改变页面背景的浅色主题会让标题栏条保持该值。
