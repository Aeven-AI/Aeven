# Agent Note: 助手 markdown 通过 HyperMarkdown 引擎渲染

Status: implemented

[English](2026-08-28-web-markdown-hypermarkdown-engine.md) | 中文

本记录中的定稿决定已由 [HyperMarkdown 负责流式定稿](../bug-fix/2026-09-08-hypermarkdown-streaming-finalization.zh.md)取代。引擎与累积字符串适配器的决定仍然有效。

## 问题

[直接 mdast 渲染器](2026-08-06-web-markdown-incremental-ast-renderer.zh.md)把流式开销约束在块这一层：它冻结已定稿的块，只重新解析源文本尾部。对由许多小块构成的回复，这是正确的约束；而对由少数大块构成的回复则不然——而后者正是助手输出的常态。一张 120 行的表格、一个 150 项的列表、一段 500 行的 fence，各自都是**单个**块，因此每到来一个分片就要把整块重新解析并重新渲染，且前沿块的开销仍随回复增长。

要堵上这一点，需要在块以下做缓存——按代码行、按表格行、按列表项——外加随不完整语法而来的流式策略判断：半写的 fence、表格行或公式，何时可以展示、何时必须扣住。这是一个渲染器，而不是一个组件，而仓库已经开始拥有一个了。

## 决策

**`MarkdownText` 是 `@aeven-ai/hypermarkdown` 之上的适配器，仓库不再拥有 markdown 渲染器。** 该组件的 props 未变，因此八处调用点全部未动；它所拥有的，是它传入的策略与它提供的 `code` 组件。

**适配器把累积字符串转换为引擎的增量。** 引擎接受写入其可变 store，而本组件的契约是关于整段文本的纯函数，因此适配器记录 store 上次被告知的内容，只写入新追加的部分——当新文本不是其延伸时则从头重新播种，正是这一点让转录可以在回复中途挂载。写入发生在 effect 中，绝不在 render 体内：store 就地变更，因此一次被 React 丢弃的 render 会损坏它。

**定稿执行 settled 解析，而不是把流冲刷出去。** 流式输出对 fence 与表格而言依赖分片方式，一次性的 settled 解析则不然。在切换时执行它，使得无论回复以何种方式到达，定稿 DOM 都完全相同——这正是奇偶校验 fixture 所断言的性质，也是读者重读一段已完成转录时所依赖的性质。

**原始 HTML 从不被解析。** `html: 'literal'` 意味着作者写下的标记以字符抵达读者，因此任何 sanitizer 的 schema 缺口都无法把它提升为元素。链接与图片的目标须通过协议白名单（`http`、`https`、`mailto`）；相对目标被允许，因为它们相对本应用自身的源解析，拒绝它们会使相对资源永远无法展示。Mermaid 图表固定在 Mermaid 的 strict 安全级别渲染，代码分包并在挂载时预加载。

`parse.ts` 保留给 `extractMarkdownPlainText`：它仍通过该语法解析以生成紧凑轨迹投影，其所用的 CJK micromark 扩展亦然。数学语法则未保留：引擎自带数学插件，使 `parseGfmWithMath` 与 `mathCompatibility.ts` 再无调用方，二者连同仅它们需要的三个 micromark 数学依赖一并移除。`CodeBlock` 与 shiki 高亮器保留，供 `ReadBlock`、`run_code` 以及其他并非 markdown 的工具卡片使用。

## 测试

`tests/fixtures/markdown-dom` 继续锚定 DOM，如今录自该引擎：fixture 的差异是一处需要评审的用户可见 markdown 变化，绝不是为重构而重新录制的对象。`markdown-dom-parity.client.spec.tsx` 通过以若干分片尺寸重放每个 fixture，断言定稿 DOM 与分片无关；`markdown.client.spec.tsx` 则守住策略：原始 HTML 惰性化、不安全协议被丢弃、相对目标被保留，以及该组件提供的行内代码可操作项。

## 考虑过的替代方案

**为直接 mdast 渲染器补上块内缓存。** 该渲染器已经存在，其奇偶校验 fixture 也已通过，因此这项改动本可以是增量式的。被否决之处在于它会长成什么：在块以下做缓存意味着要为 fence、表格、列表与数学各自拥有不完整语法策略，外加与之配套的失效逻辑——那是一整个渲染器分量的判断，只为一个消费方维护，而对面是一个已经做出这些判断的依赖。

**保留两个渲染器，按回复选择。** 被否决：该选择要在回复存在之前，依据对其形态的猜测作出；而两个渲染器意味着两份 DOM 约定、两套安全策略，以及必须彼此一致的 fixture。

**采用引擎的流式定稿（`write(…, true)`），而非重跑 settled 解析。** 它只是一次调用而非一次重新播种，并且保住了流式过程的缓存。依实测被否决：流式输出对 fence 与表格会因分片尺寸而不同，于是最终转录会取决于该回复恰好如何经网络到达。

## 影响

流式开销对照被其取代的渲染器实测（production React、独立进程、三次运行取中位数、8 字符分片）：120 行表格 19 倍、150 项列表 8.8 倍、500 行 fence 8 倍，段落无变化。块内缓存在任何单块变长之处都有回报；已闭合的块在两者中本就低廉。

渲染器自身的 chrome 既未本地化也未接入主题。引擎的表格、图表与代码工具栏取自它自己的英文字符串与 `--hm-*` 变量，因此这些控件既不跟随应用 locale，也不跟随 `--dsw-*` 主题；`MarkdownLabels.footnotes` 被接受但未被应用，因为该小节的名称由引擎自己指定。这是不拥有渲染器所付出的代价，而要堵上它，需要引擎尚未暴露的设置。

markdown 行为如今属于一个依赖，因此渲染缺陷要在上游修复并以发行版形式交付。目前有两个未决项，并作为已知缺口锚定在 `markdown.client.spec.tsx` 中：无论协议为何，锚点都会拿到 `target="_blank"`，因此 `mailto:` 会留下一个空白标签页；以及目标的协议先被逐字节区分大小写地比较、后才被规范化，因此有效的 `HTTPS://` 链接会被丢弃。

[增量渲染器 Note](2026-08-06-web-markdown-incremental-ast-renderer.zh.md) 记录了被本决策取代的那个决策。其 GFM 语法在 `parse.ts` 中保留下来；其定稿数学语法、增量解析器、mdast walker 与 KaTeX 桥接则没有。
