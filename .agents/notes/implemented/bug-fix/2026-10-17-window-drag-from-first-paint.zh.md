# Agent Note: 自首帧起即可拖动窗口

Status: implemented

[English](2026-10-17-window-drag-from-first-paint.md) | 中文

## 问题

桌面窗口不绘制标题栏（macOS 用 `titleBarStyle: 'hiddenInset'`，Windows 用 `hidden` 加标题栏浮层，Linux 用 `frame: false`），因此窗口只在页面声明 `-webkit-app-region: drag` 的位置移动。在 macOS 上，该矩形属于 `@aeven/client-ui-layout` 中 `AppFrame` 的伪元素，只有 React 挂载后才存在；启动画面与客户端的首帧样式表都没有声明。于是从创建窗口到客户端首次渲染——也就是整个启动画面期间——窗口无法拖动（[issue 138](https://github.com/Aeven-AI/Aeven/issues/138)）。

## 决策

该条带由 shell 拥有，两个可能承载窗口的文档各自绘制：

- `startPageDocument()` 只为 macOS 绘制，位于自身底色之上，因此启动画面在首次绘制时即可拖动。
- `apps/web/src/preloader.css`（内联进文档头部的首帧样式表）绘制同一条带，以 `html[data-avn-traffic-lights]` 为门槛，因此每个客户端界面在 React 渲染前、以及在任意重挂载之后都保有它。其高度即客户端表头行（`8px + var(--dsw-aeven-control-size, 40px)`），并以产品自身的 40 px 作为回退，因为首次绘制时主题样式表尚未加载。其 `z-index: 2001` 高于 shell 自己的预加载界面（2000），后者在客户端启动期间覆盖整个窗口。

`AppFrame` 不再绘制该条带，只保留把控件从条带中扣除的 `no-drag` 空洞——条带由窗口施加，而非命中测试。preload 现在在解析器创建文档元素时立刻标记该文档所属平台的窗口装饰，并在同一时刻安装 Windows 与 Linux 的标题栏条：preload 早于该元素存在，所以原先的 `DOMContentLoaded` 在每个平台都留下同样的间隙。条带本身的决策仍以 [Linux 桌面标题栏条](../architecture/2026-10-14-linux-desktop-caption-strip.zh.md) 所记录者为准，改变的只是安装时机。

## 考虑过的替代方案

**保留 `AppFrame` 的条带，并在首帧样式表中再加一份。** 同一矩形有两个所有者必然漂移——组件的高度跟随已加载的主题，shell 的回退值不会——而重挂载只会丢掉其中一份。

**在文档开始时由 preload 注入条带。** preload 早于文档元素存在，注入的样式同样需要等待解析器的机制，而该规则本就属于 shell 自己提供的文档。门槛属性仍留在 preload，因为只有载体知道平台。

## 影响

macOS 条带成为文档级规则，因此在拖动命中测试上位于客户端模态框（z-index 1000）之上，而组件规则原先位于其下（z-index 60）。条带不接收指针事件，所以点击仍能到达条带中的控件；在已打开的模态框上方、从表头行开始的拖动现在会移动窗口，这与原生标题栏一致。启动画面与客户端使用相同的高度、门槛与层序，交接时不会发生位移。

## 验证

`apps/desktop/tests/start-screen.spec.ts` 断言 macOS 文档带有该条带，而 Windows 与 Linux 文档不带。新增的 `apps/web/tests/preloader-shell.spec.ts` 断言首帧规则的门槛、高度回退、拖动声明、高于预加载界面的 z-index 以及指针透明。此处没有在运行中的窗口里实际验证该条带，那需要以 macOS 启动开发版或打包版 shell。
