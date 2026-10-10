---
description: "模型正在操作的浏览器中的屏幕指针与动作反馈。"
kind: "package-reference"
---

# @aeven/experimental-browser-overlay

[English](README.md) | 中文

## 概述

将智能体的指针与动作反馈绘制到模型正在操作的页面中，让观察浏览器的人能看到智能体即将操作的位置以及刚刚完成的动作。本覆盖层不处理输入，也不读取页面状态：宿主告诉它一个坐标和一个动作，它只负责绘制。加载该 bundle 即自动安装。

指针精灵、其旋转、双重投影光晕与运动模型，均取自 Codex 桌面应用的浏览器智能体指针——从抽取出的 bundle 中读出。精灵本身即该抽取出的资源，逐字节内嵌。

运动由弹簧驱动，可随时打断：长距离移动沿二次贝塞尔曲线划弧，指针在转弯中侧倾；短距离移动为一次带轻微过冲的滑移；飞行中改变目标会保留速度而非重新开始。抵达后指针会保持一小段阻尼摆动再静止。积分器复现自 React Spring 而非自行推导——名义上阻尼与响应相同的弹簧，若求解器不同，运动并不相同。 `setHold(true)` 在代理工作期间重复空闲摆动。同一目标的重复移动保留当前滑行，短距离移动的倾斜取决于方向而非像素距离。

精灵**不旋转**静止，保持图稿自身的朝向，并且**在其盒子内居中**。两者均由 `demo/measure-tip.mjs` 断言；见[验证指针几何](#verify-cursor-geometry)。

有一个后果需要明确说明：箭头的尖端就是精灵的左上角，因此让精灵居中会使尖端落在所传坐标左上约 9px 处。这是居中带来的取舍。若希望尖端恰好落在坐标上，请调整 `src/styles.ts` 中的 `CURSOR_NUDGE`，让尖端落在盒子中心，并接受精灵的视觉重心向右下偏移。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将 `src/index.ts` 打包为浏览器 bundle，在文档开始时注入，然后在派发动作的地方驱动它：

```js
await session.send('Page.addScriptToEvaluateOnNewDocument', { source: bundle })
await session.send('Runtime.evaluate', { expression: 'window.__aevenOverlay.click({ x: 120, y: 340 }, { label: "click Save" })' })
```

| 调用 | 绘制内容 |
|---|---|
| `moveTo(point, { mode, label })` | 将指针滑向某点，并标注动作；首次出现时在距该点 120px 处淡入并滑到其上 |
| `arrived()` | 在指针停在目标上后解析，使宿主能把先前宣告的输入落到那里 |
| `click(point, { label })` | 抵达后展开圆环、闪一下，并短暂停留 |
| `type(point, { label })` | 在某点闪烁插入符——与点击在视觉上可区分 |
| `scroll(point, { deltaY, label })` | 让指针随手势移动，方向与内容滚动的方向一致 |
| `hover(elementOrRect, { kind })` | 为目标元素描边：`hover`、`region` 或 `text` |
| `hide({ immediate })` | 淡出指针但不卸载；传 `immediate` 则在一帧内移除；下一次动作重新进入 |
| `clipTo(rect)` | 把绘制内容限制在某个视口矩形内；传 `undefined` 解除限制 |
| `setThinkEnabled(bool)` | 关闭空闲摆动，供截图或测量使用 |
| `destroy()` | 移除覆盖层及其样式表和全部监听器 |

`hover` 优先传入 `Element`。矩形是快照，页面滚动后框会留在原处；元素引用会在滚动和尺寸变化时重新测量。

`attach({ container, sound, idleHideMs, decorations })` 接收覆盖层自身的设置。`container` 是它绘制所在的元素，正是它让坐标成为宿主面板内的坐标而非窗口坐标。`sound` 为每个动作发出短促的点击音，默认关闭。`idleHideMs` 是空闲淡出时间，`0` 使指针保持可见。

`decorations` 绘制标记目标或标记瞬间、而非标记指针本身的内容 —— 命名目标周围的框、点击的圆环与闪光、输入动作的插入符。它默认开启。传入 `false` 让屏幕上只剩指针，适用于页面属于读者的宿主：关闭后覆盖层不创建框与标签，`hover` 不绘制任何内容，而 `click` 与 `type` 只放置指针，不留下这两种标记。

坐标是视口 CSS 像素，锚点为箭头的**尖端**：光标盒的原点恰好落在你传入的坐标上，箭头主体由此向右下方延伸，与常规指针一致。`demo/measure-tip.mjs` 会在 2 像素以内断言这一点。

<a id="verify-cursor-geometry"></a>

### 验证指针几何

```sh
node packages/experimental/browser-overlay/demo/measure-tip.mjs
```

断言精灵在光标盒内居中（误差不超过 0.01px）、精灵层自身不带变换、且静止旋转为零。尖端位置仅作信息报告而不作断言，原因如上。

改动精灵、偏移、旋转或变换组合后请重新运行。截图无法校验以上任何一项：居中的箭头与偏离十像素的箭头在 PNG 中看起来相同，倾斜的精灵与倾斜的图稿也无法区分。

该脚本会先关闭空闲摆动。这不是细节：摆动会按设计旋转精灵，因此摆动期间测量会在每一帧给出不同角度——看起来像校准缺陷，实际并非如此。

### 查看全部状态

```sh
node packages/experimental/browser-overlay/demo/run.mjs
```

在演示页面上驱动全部七种状态，把截图写入 `demo/out/`，并同步断言：精灵是复制的资源且尺寸与设计一致、指针锚定在所请求坐标、悬停框在滚动后仍然成立、覆盖层从不接受指针事件、`destroy()` 不留下任何节点或样式表。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

覆盖层是一个追加到 `documentElement` 的根元素——不是 `body`，因此页面替换 body 也不会让它变成孤儿。所有内容都位于 `aeven-browser-overlay` 类名前缀之下，并处于单一注入样式表内，因此不会有任何样式泄漏到页面自身，卸载时也能一次性移除整个表面。

`contain: layout style` 隔离布局与样式计算，但有意不使用 `contain: paint`：绘制包含会让根元素成为其自身 `position: fixed` 子元素的包含块，把它们锚定到根元素而不是视口。精灵尺寸被固定，以免被页面全局的 `img` 规则改变。

精灵是使用 base64 data URI 的 `<img>` 而非文件：相对资源 URL 会按目标页面的源解析，而请求可能被页面 CSP 拦截。data URI 两者都不会发生。

在文档开始时注入时，bundle 会在解析器创建根元素之前运行。因此 `attach()` 无论何时都会构建其元素，并在文档就绪后追加，这正是 `installOverlay()` 在文档生命周期任意阶段都安全、而在就绪前调用动作是空操作而非报错的原因。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Cua Driver MCP 提供方](../computer-use-cua-driver-mcp/README.zh.md) — 本覆盖层所配合的浏览器动作提供方；其 `browser_*` 工具就是调用方要喂给覆盖层的内容。
- [实验性包](../README.zh.md) — 本包所属的分组。

-----

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

本覆盖层只绘制宿主告知的内容，不验证页面的任何状态。

- **由宿主驱动，而非自我观测。** 覆盖层不会安装页面监听器来推断动作。宿主忘记调用就不会有反馈；宿主报告了并未发生的动作，则会自信地把指针画在没有任何东西被触碰的点上。
- **每个文档一个实例。** 安装通过 `window` 全局变量保持幂等。来自不同宿主的两个 bundle 会共享一个覆盖层，而不是各自绘制。
- **不覆盖跨框架内容。** iframe 内容是独立文档；覆盖层只覆盖其被安装进的文档。
- **旋转是行进中的临时侧倾，而非姿态。** 精灵静止时不旋转，沿弧线移动时最多侧倾 70°，随后回到零。除插入符和圆环外，没有按动作区分的姿态（按压、输入、拖拽）。
- **尖端不是锚点。** 让精灵居中会使箭头尖端落在坐标左上约 9px 处，因为尖端就是精灵的左上角。替代方案见概述中的说明。
- **尚未接入任何提供方。** 本包只负责绘制；目前还没有调用方。把它接到浏览器提供方的 `browser_*` 工具结果上，是剩余的工作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

两个演示脚本即回归测试套件。`measure-tip.mjs` 守护代码评审中看不见的那条不变量——箭头指向宿主所说的位置；`run.mjs` 守护各种视觉状态与卸载行为。

</details>

**运行时不变式：** 不发布伴随插件，因为该覆盖层是浏览器客户端一侧，只对宿主交给它的指针状态作出反应，因此它不拥有宿主侧的次序，也不保留任何可供监听器比较的跨调用状态；上文列出的演示脚本就是它的回归面。
