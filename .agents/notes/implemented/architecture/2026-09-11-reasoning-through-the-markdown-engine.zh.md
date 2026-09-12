# Agent Note: 助手的 reasoning 经由 Markdown 引擎渲染

Status: implemented

[English](2026-09-11-reasoning-through-the-markdown-engine.md) | 中文

## Problem

一个 Assistant 步骤的正文经由 HyperMarkdown 渲染，而它的 reasoning 没有。`AssistantMarkdown` 把 `kind: 'text'` 块交给 `MarkdownText`，也就是引擎的适配器，却用 `ReasoningRow` 渲染 `kind: 'reasoning'` 块，那是一个本包自有的折叠组件。因此一个步骤有多少块就有多少渲染器，而引擎整条 reasoning 管线——`<think>`、`<thinking>` 与 `<reasoning>` 三种块类型、`patterns.reasoningOpenRegex`、`detectBlockType` 对它们的优先检查、`streamReasoning`、已结算路径上的 `splitReasoning`，以及用于外壳的 `controls.reasoning`——虽然完整实现，却完全没有被这个客户端使用。

代价不只是重复。一段很长的思考恰恰是引擎缓存存在的理由所在，而它并没有得到这些缓存；同时，一个步骤有两个渲染器，也就意味着「思考何时结束」有两个答案——`ReasoningRow` 跟随块的尾部，引擎跟随它自己的流状态。

本说明是把整个集成立项时排定的第一阶段：让引擎成为一个步骤所说一切的唯一渲染器。后续阶段在 Consequences 中列出。

## Decision

**一个步骤的 reasoning 作为引擎自己的 reasoning 块写入源文本。** `AssistantMarkdown` 把该步骤的块组合成一条累积的 Markdown 字符串：`text` 块原样追加，`reasoning` 块由 `reasoningSource` 包装，整条交给引擎渲染。`ReasoningRow` 与它的样式表已经删除；`markdownLabels` 现在携带该块的两个表头，因此 `thinking` 与 `thoughtFor` 通过与代码围栏复制文案相同的标签适配器遵循应用的区域语言。

**块只在作为步骤最后一个块时才保持打开。** 只有当某段 reasoning 位于源的末尾且步骤仍在流式输出时，`reasoningSource(text, open)` 才只写 `<think>…` 而不写闭合标签；其后的任何内容——正文、图片、工具调用头——都会闭合它，因为一段已被别的东西接续的思考已经想完了。打开的块就是引擎的「仍在思考」：读者在模型工作时看到思考在跑，停下后看到一个收起的块，这正是引擎本就具备的行为。`lastEngineBlock` 让「最后」指的是源而不是步骤，因此位于末尾的工具调用头——由另一个节点绘制、从不进入源文本——既无法让一段思考保持打开，也无法留下一个源里再没有任何东西能闭合的块。

**一段 reasoning 正文无法关闭它自己的块。** 正文若包含字面量 `</think>`，就会提前结束该块——引擎在解析之后匹配该标签，因此任何 Markdown 转义都到不了它。`defuseClosingTag` 把那个 `<` 换成全角孪生字符：读起来一样，而不再是标签。不含该标记的正文原样返回。

**步骤仍然在引擎无法渲染的内容处断开。** 一个图片图库或一个无法识别的块会结束当前的 run，并在 run 之间输出，从而保住撰写的顺序；工具调用头一如既往地在这里被跳过，因为 `ChatView` 的分组遍历把它们画成自己的节点。

## Alternatives considered

**在引擎上增加类型化 parts API（已实现，随后回退）。** 第一次尝试新增了 `Part`、组件句柄上的 `writeParts`，以及 `Renderer` 内部的 part 记账，使宿主可以直接流式输入 `{ kind: 'reasoning' | 'markdown', text }`，而无须把类型编码进文本。它在单一批次下可用，却在步骤交错 part 的那一刻失效：引擎的增量状态机从缓冲区推断块的类型，而 part 边界是与之竞争的第二种文档语法。边界文本泄漏进了它本该结束的那个块，某个 part 的后继可能被判定成它的前驱，而修复一路牵连 `streamMd`、`drainMd`、`streamProcess` 与 `streamReasoning`——一个九百余测试的引擎里六个相互影响的位置，只为服务于该引擎唯一的消费者。整体回退。引擎自己的标签协议是它已经实现并测试过的文档语法，使用它的代价是适配器里的五行代码。

**保留 `ReasoningRow`，改为给引擎一个宿主提供的 reasoning 组件。** 引擎保留自己的管线并调用本包的折叠组件。它精确保住旧的外观，但作为终点被否决：引擎的 reasoning 块正是要被采纳的东西，而一个由引擎调用的外壳只是旧组件加了一层间接。如果将来想找回应用自己的折叠样式，它仍是更便宜的做法。

**用自定义标签序列化，并把引擎从 `html: 'literal'` 切走。** 在立项时已被否决，现在仍然否决：它为一个渲染上的便利，用「作者标记永不被解析」的保证去交换。

**每个块作为一个 part 顺序喂给引擎。** 新块就是一份新的完整源，于是一段思考无法像回复那样增长，而且每个分块都会重渲染它整个块——这正是引擎存在的意义所要避免的代价。

## Testing

`engine-reasoning.client.spec.tsx` 从步骤这一侧守住新行为：引擎绘制该块，已结算的块初始收起、点击后展开，运行中的块保持打开，reasoning 夹在正文之间时撰写顺序得以保留，一个步骤对连续正文只用一个引擎实例，图库会把它断开，而只有工具调用的步骤仍然什么都不渲染。`markdown.client.spec.tsx` 守住源文本契约：被包装的正文在引擎内渲染而非旁边，`defuseClosingTag` 对普通正文不作改动且只触碰闭合标签，标签也能到达表头。`chat-font-axis-styles.client.spec.ts` 通过覆盖它的 Markdown 宿主样式表，读取引擎的 reasoning 块是否符合对话的字号轴。另外四个断言 `ReasoningRow` DOM 的既有测试——它的运行环、它的 `data-state`、它的最新一行摘要、它的 `thinkBody`——被改写为断言读者可见的行为，轮次过程折叠测试现在断言被封住的折叠持有的是一个收起的块，而不是思考的文本。

## Consequences

既有文本记录中的每个 reasoning 块现在都经由引擎重新渲染：读者看到的是每条思考一个收起的块，而不是一个 Think 行，思考自身的用时来自引擎的时钟，而不是 `ReasoningRow` 在步骤中的位置。思考 / Think 标签没有变化，两个表头都已本地化。

引擎的 reasoning 外观现在就是应用的 reasoning 外观，因此重新定型意味着从 Markdown 宿主样式表覆盖引擎的 `--hm-*` 取值——`MarkdownText.module.css` 已经为该块的字号、行高与颜色这么做了。它的折叠箭头与其收起/展开的几何形状仍属于引擎。

工具行、图片以及一个步骤各节点之间的顺序没有变化，仍在引擎之外。那正是本说明所开启的集成中剩下的工作：工具行作为宿主提供的块经由同一个引擎渲染，而一个步骤的各个 run 在条件具备后合并为一片区域。这也是 `AssistantMarkdown` 仍然把一个步骤拆成多个 run 的原因。
