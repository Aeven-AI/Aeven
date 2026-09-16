---
description: "dsh Web 客户端的主题与正文字号设置：--dsw-* token 样式表、ThemeRuntime 状态、「通用」设置行与插件前引导。"
kind: "package-reference"
---

# @aeven/client-ui-theme

[English](README.md) | 中文

## 概述

`dsh-client-ui-theme` 让 Web GUI 用户在设置中选择 `light`、`dark` 或 `system`，并把会话正文字号设为 12 至 17 px。回环客户端把两个值存入 `ui-theme` 设置命名空间，本地提供方默认将其持久化到 `$AVN_HOME/settings.yaml`。插件通过 `prefers-color-scheme` 解析 `system` 并发布不可变的 `ThemeSnapshot`；ui-layout 把每份快照应用到 document。本包还提供 `--dsw-*` token 样式表，并注入同步引导，使所选调色板与字号在静态外壳预加载页绘制前生效。第三方主题可通过 `ctx.theme` 注册别名 token 覆盖。

Aeven 基线集中位于 `aeven-language.css`：Google Sans Flex 字体角色、暖中性色彩别名、1024px 会话宽度、响应式页面与侧栏内边距、280px 侧栏宽度、400ms 侧栏过渡、间距、控件尺寸和圆角都是供组件 CSS 使用的单一来源变量。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

用户从设置（「通用」分区）的两行中切换配色方案与正文字号；在回环浏览器上，两个选择都会跨重启持久化。功能插件通过 `ctx.theme` 消费当前快照，并在 CSS 中读取 `--dsw-*` token；它们不自行管理主题状态。

### 外观与字号

插件在「通用」分区注册外观偏好方块与字号步进器。步进器接受 12 至 17 px 的整数，默认值为 14 px。它以相同增量调整会话标题与基础文本，包括用户气泡与 composer 草稿；流内行的标题、摘要与表格跟随比正文低一档的字号，小号文本和代码保持固定字号。每次通过的变更都经 Host settings API 写入。连续快速变更按操作顺序携带命名空间 revision 串行写入，最新写入被拒时重新加载持久值。非 loopback 页面把两个选择都保留在进程内。

### 注册主题

组合可以通过 `ctx.theme` 注册带别名 token 覆盖的第三方主题 id；覆盖层按注册顺序折入活动快照的 token 中。移除其中一个绝不会覆盖最后一个持久化的内置偏好。第三方主题 id 仍是进程内扩展，不会跨越内置 settings schema。

### 插件前调色板

当主机组合包含 HTTP 服务器时，宿主侧会把已注册的 `ui-theme` 设置或 schema 默认值嵌入每份 index 响应。浏览器在加载页面渲染前设置 `color-scheme`、`body[data-ds-dark-theme]` 与 `--dsh-content-font-size`，因此首帧绘制就采用所选调色板与字号。

### 静态外壳预加载页

品牌标识与转轮标记由 `apps/web/index.html` 而非 ui-theme 的 Host 插件拥有。生产构建会在 document head 中内联该样式表，因此该视觉在入口 module、module loader 或 React 运行前就已带样式。Host 注入的主题引导仍紧接 opening body tag，并在静态视觉绘制前选择其明色或暗色回退。

关闭与失败呈现由 Web 启动内核拥有；参见 [dsh-client-web](../web/README.zh.md)。ui-theme 只拥有应用到该静态视觉的调色板状态。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

服务拥有主题与字号状态并发布快照。ui-layout 呈现器应用这些快照，token 样式表则拥有颜色与会话文本尺度。

### 样式表

`src/styles/` 下有六张样式表，由 ui-theme 的动态客户端 entry 依次导入：`base.css`、`design-platform.css`、`scrollbar.css`、`gradient-shadow-text.css`、`aeven-language.css` 与 `highlight.css`。客户端 bundle 将其编译并注入为插件持有的全局样式，因此卸载与 HMR 会随 ui-theme 一同移除。`scrollbar.css` 是 `--dsw-alias-scrollbar-*` token 的唯一消费方，必须排在声明这些 token 的 `design-platform.css` 之后。`aeven-language.css` 位于生成的排版样式表之后，因此其产品基线可以映射共享变量而无需复制组件规则。`highlight.css` 为 tool card 与 markdown fence 的 highlight.js token class 着色。


`gradient-shadow-text.css` 从 `--dsh-content-font-size` 派生 `--dsh-content-font-delta`，并以该增量移动 Markdown 标题与基础文本阶梯。它同时持有低一档变量 `--dsh-content-font-size-secondary`，供表格变体与比正文低一档的流内行使用，配套的 `--dsh-content-font-delta-secondary` 承载该档的行高位移。该档的映射位于 `src/theme-settings.ts` 的 `secondaryFontSize`——低于 14 时取设置值 −1，14 与 15 时守住 14 下限（再降一级就会落到 13px），16 及以上取设置值 −2——因为任何基于正文字号的 `min`/`max` 组合都无法在阶梯中间跳过单一取值；样式表中声明的只是会被启动脚本与 presenter 覆写的回退值。紧凑的小号文本与代码变体保持固定字号——最小一档为导出的 14px/20px——且每个复合字体 token 都显式写出 450，因为省略字重的 `font` 简写会把它重置为 400。阶梯之外，用户气泡与 composer 草稿直接读取正文档变量对，流内行的标题及摘要读取低一档变量对。该表还持有阴影阶（`--dsw-shadow-lv*`）与 elevation token：`--dsw-elevation-stroke` 经可重绑的 `--dsw-elevation-stroke-color` 画 0.5px 发丝描边，`--dsw-elevation-panel`/`--dsw-elevation-prominent` 在描边之上叠两层极淡柔光，因此高层级表面设 `border: 0`，不再有占布局的轮廓；派生 token 逐元素重声明，使表面对描边色的重绑真实生效。Aeven composer 明确不使用这些投影（[elevation 笔记](../../../.agents/notes/implemented/feature/2026-09-01-web-elevation-stroke-shadows.zh.md)）。

### 滚动条重新绑定

`scrollbar.css` 在 `body` 上把 `--dsh-scrollbar-thumb` 与 `--dsh-scrollbar-thumb-hover` 绑定到 l1 基础表面 token；高层级表面（菜单、浮层、对话框）在自己的容器上把它们重新绑定为 l2 token；这组变量的另一个合法目标是 `transparent`（ui-trajectory 的摘要区域在既无 hover 也无 focus-within 时就这样重新绑定）。标准属性——`scrollbar-width: thin`——声明在 `body *` 上，供每一个实现了它的引擎使用，因为只有这条路径能给滚动盒子留下完整宽度：正是 `::-webkit-scrollbar` 皮肤把滚动条逼进槽位，并从盒子上切走那条带子。伪元素皮肤则是回退路径，位于 `@supports not (scrollbar-width: thin)` 之内，供无法遵循标准属性的引擎使用（chromium 121 之前、WebKit 在 Safari 26.2 之前），因此 hover token 只在这条路径上渲染。已经没有任何样式表再去补偿滚动条的宽度：会话滚动视口对称地预留自己的槽位，而在滚动条浮动之处则完全不预留（[滚动条笔记](../../../.agents/notes/implemented/bug-fix/2026-09-13-overlay-scrollbars-return-the-gutter.zh.md)）。

### 偏好持久化

在 loopback 浏览器上，服务先以 schema 默认值立即提供自身，随后加载 `ui-theme` 命名空间，并把每次通过的主题或字号变更经 Host settings API 写入。收到推送的设置变更时或重连后都会重新拉取该命名空间。非 loopback 页面不会创建该 Host-backed scope。该持久化边界由 [Host 支撑的偏好笔记](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.zh.md) 拥有。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖布局呈现器、token 消费方与样式规则。

- [ui-layout](../ui-layout/README.zh.md)——应用解析后主题快照的呈现器。
- [ui-sidebar](../ui-sidebar/README.zh.md)——滚动条重新绑定约定的消费方。
- [ui-conversation](../ui-conversation/README.zh.md)——composer 席位与视图 chrome，二者都以滚动视口的对称槽位居中。
- [Web 样式](../../../docs/web-styling.zh.md)——Web 客户端组件的权威样式规则。
- [Host 支撑的偏好](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.zh.md)——持久化边界决策。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义主题扩展表面与颜色权威；它们是当前包约束。

- **第三方主题是扩展点，不是产品**：注册主题意味着覆盖同名别名变量；目前不会验证一组覆盖是否完整。
- **token 样式表是颜色值的唯一权威来源**：设计系统中缺失的值会有意不补入；一律采用最接近的语义 token，设计负责人批准的新增值须在同一变更中以一个静态尺度层级与一个语义别名的形式进入。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。settings scope 校验并发布持久 theme section，registry 与自身变更同步发出 `theme/change`；两者关系由 Host、scope 与 service 测试覆盖。
