# Agent Note: 静态 Web 外壳预加载页

Status: implemented

[English](2026-09-02-static-web-shell-preloader.md) | 中文

## 问题

Web 应用在入口 module 与客户端插件 bundle 加载期间必须用带样式的加载视觉覆盖页面。由 Host 插件贡献的预加载页不会存在于 `apps/web` 源 document 与独立 worker-preview 产物中；让动态插件组合拥有其 CSS 与标记，也会使最早视觉依赖它本应遮盖的系统。渲染阻塞的链接样式表仍会拖住首帧：Vite 会把该文件折进合并后的应用 CSS，Host 的 head 注入会在 body 前放入 classic bootstrap 脚本，浏览器会在这些 payload 到达前一直显示白页。

## 决策

`apps/web/index.html` 在应用 root 前包含预加载页标记，并把 `src/preloader.css` 链接为源样式表。`inlinePreloaderCss` 用包含该文件的 `<style>` 元素替换该 link，使首帧不必等待样式表请求。`destageBuiltStylesheets` 把其余每张产出样式表作为 `rel="preload" as="style"` 加载并在 load 时提升，因此 vendor 与应用 CSS 不能拖住首帧。Head 中的 `script-src` 注入带 `defer` 渲染，从而与已延迟的 Vite module 标签保持 bootstrap-before-entry 的 document 顺序，同时不推迟 body 解析。

预加载页样式表只拥有首帧布局、明色与暗色回退，以及淡出和转轮动画。ui-theme 的 Host 侧继续在 opening body tag 后立即注入持久偏好引导。该脚本会在 parser 到达静态预加载页前应用 `body[data-ds-dark-theme]`，而浏览器侧 ThemeRuntime 在插件激活后仍是权威。

`avn-client-web/src/preloader.ts` 控制已有元素。成功的 Web 启动会在第一份侧边栏列表与所选会话历史到达后用 400ms 淡出，再将元素移出布局；启动失败时，它会在 `BootPage` 渲染诊断前立即隐藏元素。静态元素拥有加载呈现时 `BootPage` 保持视觉静默，而不含 Web 外壳的 document 仍使用其自有进度视觉。Worker preview 会为 source chooser 隐藏静态元素，再在所选 image 与插件树启动期间恢复它。[外壳数据等待](2026-09-08-web-preloader-waits-for-shell-data.zh.md)拥有该成功启动时机。

## 验证

客户端单元测试覆盖动画关闭、立即隐藏与恢复、取消、缺少静态元素，以及 BootPage 失败回退。构建产物测试要求标记位于应用 root 前、document `<style>` 中内联 `#avn-preloader` 规则，并要求其余样式表只以 preload-plus-onload 标签加 `noscript` stylesheet 回退出现。Head `script-src` 行带 `defer` 渲染；body `script-src` 行不带。真实 Chromium 主题场景会拦住产出样式表与应用插件请求，并断言可见静态预加载页采用内联 CSS 中的持久化深色偏好。Worker-preview 验收继续覆盖 source chooser 与完整启动。

## 考虑过的替代方案

**继续通过 Host index injection 提供视觉。** 这会使源 document 与静态 preview document 缺少自己的首帧视觉，并把外壳呈现交给可选的组合插件。

**由入口 module 创建视觉。** 浏览器必须先下载并执行 JavaScript，才能显示该 module 创建的标记或样式，因此仍会保留本决策要消除的白页时段。

**保留渲染阻塞的链接样式表，无论是否带最终 href preload。** Vite 会把源文件与其余 CSS import 合并，因此首帧会等待完整的 vendor 与应用样式表。单独的未打包文件在 overlay 能绘制前仍要一次往返。

**让 bootstrap combo 在 head 中继续阻塞 parser。** Vite 入口已经是 deferred module 脚本；head `script-src` 标签上的 `defer` 在不推迟 body 解析的前提下保持 bootstrap-before-entry 顺序。

**把持久主题解析移入静态 HTML。** 静态 HTML 无法嵌入 Host 设置。现有同步 Host 引导会提供偏好，不在外壳中复制 ThemeRuntime 语义。

## 后果

应用从 document 字节起即有带样式加载内容，常规启动不再暴露中间空白应用 root，也不会在等待 CSS 时显示白页。外壳新增一小段静态标记，并内联其首帧 CSS。其余 CSS 是插件加载期间完成的非阻塞 fetch。视觉与生命周期控制器共享固定的 `avn-preloader` id、class name 与 400ms 淡出时长，因此改变这些值时必须同步更新 HTML、CSS、控制器与产物测试。不提供 `apps/web` 的组合仍保留无框架 BootPage 回退。
