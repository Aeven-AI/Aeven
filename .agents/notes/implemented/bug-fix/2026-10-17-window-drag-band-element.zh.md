# Agent Note: 窗口拖动条是一个元素

Status: implemented

[English](2026-10-17-window-drag-band-element.md) | 中文

## 问题

桌面窗口只在页面声明 `-webkit-app-region: drag` 的位置移动。[自首帧起即可拖动窗口](2026-10-17-window-drag-from-first-paint.zh.md) 把该矩形写进两份样式表的 `body::before` 规则，使其在 React 挂载前就存在。Chromium 只从元素上读取可拖动区域，在伪元素上忽略该属性，因此这两条规则从未成为拖动区域：无论条带的高度或 z-index 如何，启动画面与应用程序中的窗口都无法拖动。

## 决策

每一条拖动条都是真实元素，文档所需的矩形由拥有该文档的一方绘制。

- `apps/desktop/src/window-drag-band.ts` 拥有这条拖动条：`data-avn-drag-band` 属性、使条带可拖动的声明，以及 `installDragBand(doc, { height, background })`——它更新文档已有的那一条，而不是再叠一条。preload 通过它安装 Windows 与 Linux 的标题栏条带，这两个平台因此保留可拖动的标题区域。
- macOS 启动画面渲染全宽的 `<div class="avn-drag-band" aria-hidden="true"></div>`，因为该页面自身没有控件。
- `apps/web/index.html` 在 `#avn-preloader` 内放置一条拖动条，`apps/web/src/preloader.css` 在 `html[data-avn-traffic-lights]` 下按客户端表头行的高度为其设样式。启动遮罩本身声明 `drag`，且 `#avn-preloader.screen-hidden` 为 `display: none`，因此隐藏后的遮罩不会拦截落在取代它的工具栏上的点击。
- `AppFrame` 把 `.dragBand` 作为自身框架中的一个元素渲染，高一行表头，`z-index: 29`——高于会话记录中的滚动控件，低于表头（30）与侧栏（50）。其 `no-drag` 空洞不变：窗口会把每个控件从条带中扣除，表头则绘制在条带之上。

门槛属性仍由 preload 设置，因为只有载体知道平台。

## 考虑过的替代方案

**保留伪元素并提高其 `z-index`。** 否决：该属性在伪元素上被忽略，`body::before` 无论怎么设样式都不会成为可拖动区域。这个回归在样式表里看不出来，也正是该样式表的 spec 断言了无法生效的声明的原因。

**由 preload 向每个文档注入拖动条。** 对 macOS 否决：应用程序页面已由 `AppFrame` 按表头高度绘制自己的条带，再注入一条就多出一个矩形；载体也没有理由知道客户端表头行的高度。

**让启动遮罩充当应用程序的拖动区域。** 否决作为唯一区域：客户端绘制后遮罩即离开文档，客户端仍需要自己的条带。遮罩声明 `drag` 覆盖的正是该条带挂载前的那些帧。

**像以前一样把条带放在表头之上。** 否决：位于表头之上时，一旦某个控件的 `no-drag` 空洞缺失或新增，条带会吞掉本应由空洞保留的点击。位于表头之下，自身需要拖动的控件仍能把拖动交给窗口。

## 后果

页面绘制条带之处，窗口即可拖动——这是前一份 Agent Note 未能兑现的行为。条带是一个元素，因此像元素一样绘制并参与命中测试：预加载条带随其遮罩一同消失，启动画面的条带横跨窗口，应用程序的条带位于工具栏之下。

Chromium 从元素矩形读取拖动区域，条带的尺寸因此成为布局事实，而不再是一条无人应用的声明。三条条带共用同一个高度表达式（`calc(8px + var(--dsw-aeven-control-size, 40px))`），启动画面把产品自身的 40 px 作为回退重述一次，因为其首次绘制时主题样式表尚未加载。

## 验证

`apps/desktop/tests/window-drag-band.spec.ts` 固定：`installDragBand` 创建一个带属性的元素、更新文档已有的条带、在解析器创建 body 之前把条带留在文档根上，并携带 `-webkit-app-region: drag` 与 `pointer-events: none`。`apps/desktop/tests/start-screen.spec.ts` 固定只有 macOS 文档携带该元素。`packages/client/web/tests/preloader-styles.client.spec.ts` 固定首帧样式表的条带规则、遮罩自身的拖动区域，以及隐藏遮罩的处理。曾守护伪元素规则的 `apps/web/tests/preloader-shell.spec.ts` 随该规则一并删除。此处未在运行中的窗口里实测条带，那需要以 macOS 启动开发或打包后的外壳。
