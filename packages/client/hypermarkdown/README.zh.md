---
description: "为 avn Web 客户端渲染 assistant 输出的流式原生 Markdown 引擎：把已稳定的块缓存到代码行、表格行与列表项级别，使不断增长的回复不会重复解析已完成的内容。"
kind: "package-reference"
---

# @aeven/client-hypermarkdown

[English](README.md) | 中文

## 概述

`avn-client-hypermarkdown` 是 Web 客户端对话记录背后的 Markdown 引擎。它渲染不受信任的 GFM、TeX 公式、带语法高亮的代码围栏与 Mermaid 图表，并且专为分段到达的文本而设计：已经稳定的块不会被再次解析，因此增长到数千行的回复只需为变化的部分付出代价。渲染器按代码行、表格行与列表项分别缓存，在每一步都把流式输出与完整解析结果对齐，并通过自己的 external store 发布最终渲染结果，使逐词淡入动画在 finalize 后依然保留。

本仓库内唯一的消费者是 `ui-primitives` 中的 [`MarkdownText`](../ui-primitives/src/markdown/MarkdownText.tsx)，它负责不受信任输出的策略：原始 HTML 从不被解析、不安全的链接与图片协议被拦截、Mermaid 以 strict 安全级别运行。本包则负责引擎本身——解析流水线、流式缓存、块修复阶段、工具栏外观，以及它渲染时使用的样式表。

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

挂载组件、按界面需要挂上插件，并通过命令式 handle 驱动流式输出。重型引擎是可选加入的：某个槽位留空会降级而不是失败，因此 `$x$` 保持字面量、代码围栏不高亮、```` ```mermaid ```` 围栏渲染为代码块。

```tsx
import { HyperMarkdown, katexPlugin, highlightPlugin, mermaidPlugin } from '@aeven/client-hypermarkdown'

const plugins = {
  math: katexPlugin(),
  code: highlightPlugin(),
  diagram: mermaidPlugin({ securityLevel: 'strict' }),
}

<HyperMarkdown
  ref={handle}
  streaming
  animation
  html="literal"
  plugins={plugins}
  translations={labels}
  components={components}
/>
```

回复流式到达时，对每一帧调用 `handle.write(chunk, false)`，结束后调用一次 `handle.write('', true)` 完成 finalize；`handle.reset()` 开始一个新文档。`md` 则用于一次性渲染完整文档。导入某个插件工厂本身不会加载它背后的库——Mermaid 与围栏高亮器都在首次使用时才解析各自的重型依赖。

Mermaid 图表默认提供缩放控件与指针平移。普通滚轮输入会缩放全屏图表；行内图表要求按住 Ctrl 或 Command，或者使用触控板双指缩放，以便普通滚轮输入继续滚动对话记录。把 `controls.diagram.panZoom` 设为 `false` 可禁用这些交互。

本包会自行导入自己的样式表，因此渲染该组件的消费者无需另外导入。`katex/dist/katex.min.css` 与 `tippy.js/dist/tippy.css` 仍由宿主负责，因为 KaTeX 与 Tippy 是宿主安装的可选 peer。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 流式契约

源文本被施加到一个可变的分实例 store 上；`md` 则是累计文本的纯函数。两者的协调方式是记录 store 已经被告知的内容，因此对话记录可以从回复中途挂载：当新文本是上次施加内容的延伸时，组件只写入追加部分，否则重新播种。

流式文本被替换时，`replaceStream` 会先清除旧解析状态并写入替换文本，然后才通知订阅者，避免在两步之间发布空文档。

块边界靠扫描而非猜测，最后一个完整边界之前的内容全部视为已稳定：代码行经由行级缓存重新渲染，表格行与列表项各有自己的缓存。`engine/repair/**` 在 unified 流水线看到内容之前，先归一化模型实际产出的语法——未闭合的强调、跨分片切断的公式定界符、任务列表标记、setext 标题、表格形状——这正是半写状态不会画出下一帧又丢弃的标记的原因。表格行是自身以管道符开头的那一行，因此项目符号里的 shell 管道、正则交替或 `||` 无论带多少管道符都仍是散文（[缘由](../../../.agents/notes/implemented/bug-fix/2026-09-28-table-repair-leading-pipe.zh.md)）。

### 引擎负责的范围

| 领域 | 源码 |
|---|---|
| 流式缓存 | `src/engine/cache/**` |
| 边界扫描与流状态 | `src/engine/stream/**`、`src/engine/line-index.ts` |
| Markdown 修复 | `src/engine/repair/**` |
| 解析流水线与净化 | `src/engine/processors.ts`、`src/engine/sanitize.ts` |
| 围栏、表格、图表与推理外观 | `src/engine/code/**`、`src/engine/table/**`、`src/engine/mermaid/**`、`src/engine/reasoning/**` |
| 插件工厂 | `src/engine/plugins/**` |
| 样式表 | `src/styles/hypermarkdown.css` |

### 样式

引擎用声明在 `.hypermarkdown` 上的 `--hm-*` 自定义属性绘制自己的外观。样式表是使用原生嵌套的纯 CSS，并随产物一起分发：构建的 static-linked 预设会把它与 JavaScript 一起输出并保留相对导入，因此类名哈希与投递由 shell 的 CSS 流水线负责。
表格单元格在最大宽度 32ch 内换行；超过容器宽度的表格可以水平滚动。行内代码使用 `--hm-size-small`、上下 1px 左右 6px 的内边距、16px 圆角和 `#f2f2f2` 背景。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Web 客户端](../../../docs/subsystems/web-client.zh.md)——客户端库经由编译 shell 到达浏览器的方式。
- [ui-primitives](../ui-primitives/README.zh.md)——消费者，以及为本引擎负责不受信任输出策略的包。

-----

<a id="model-experience"></a>
## 模型体验

无：该引擎在浏览器中渲染 assistant 输出，对产生该输出的请求没有任何贡献。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是移植后引擎的当前约束，而不是组件路线图。

- **引擎自身的外观未本地化、未主题化**——表格、图表与代码围栏工具栏使用引擎自带的英文字符串与 `--hm-*` 变量，因此这些控件既不跟随应用语言，也不跟随 `--dsw-*` 主题。宿主通过 `translations` 为脚注标题与复制控件提供自己的文案。
- **样式表需要原生 CSS 嵌套**——本次移植把上游 SCSS 作为保留嵌套的纯 CSS 发布，而不是在构建期展平（本仓库没有 Sass 步骤），因此该样式表需要支持 CSS Nesting 的浏览器：Chrome 120+、Safari 17.2+ 或 Firefox 117+。
- **KaTeX 与 Tippy 的样式表仍由宿主负责**——两者都没有被内联进本包的样式表，因此渲染公式或工具栏的宿主必须自行导入 `katex/dist/katex.min.css` 与 `tippy.js/dist/tippy.css`。缺少它们时内容仍会渲染；公式丢失字体，tooltip 丢失定位。
- **没有浏览器级别的渲染测试通道**——测试套件通过 jsdom 与静态标记驱动引擎，因此工具栏外观的布局、绘制与滚动行为仅由 shell 自己的 Web 端到端测试覆盖。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

本包是移植而非分叉：源码从独立的 `@aeven-ai/hypermarkdown` 仓库（v0.4.4）原样复制而来，以便源码在本仓库内可直接编辑，并使改动经由本仓库的构建而非一次 npm 发布到达 Web 客户端。由此带来的三处机械差异是唯一有意的偏离：

- 相对导入带显式 `.ts` 扩展名，上游的 `lib/` 目录在本仓库为 `src/engine/`（本仓库中 `lib/` 表示构建产物）；
- 上游的 `src/index.tsx` 变为 `src/index.ts`（barrel）加 `src/HyperMarkdown.tsx`（组件），因为配置目录与库注册表检查都以 `src/index.ts` 为准；
- 四个插件工厂从包根导出而非 `plugins/*` 子路径，因为 static-linked 库经由单一根入口到达 shell。各模块本身未改动，因此每个工厂仍是独立文件。

引擎自带的测试套件随源码一起迁移，并且完全离线运行：`tests/` 下共 62 个 spec 文件，按边界分为 `unit/`、`correctness/`、`streaming/`、`ui/`、`api/`、`plugins/`、`security/` 与 `coverage/`（最后一组钉住引擎有意保留的防御分支）。`tests/` 下的一切都是上游套件按本仓库 `*.client.spec.*` 命名约定改名而来；仅示例应用的 spec 被舍弃，因为 `example/` 不属于该组件。

</details>

**运行时不变式：** 不发布伴随包（No companion is published）。该引擎是纯 props-in 的 React 代码，没有 Cordis API——没有事件、没有服务、没有跨插件的可变状态；其契约由本包自己的 spec 直接断言。
