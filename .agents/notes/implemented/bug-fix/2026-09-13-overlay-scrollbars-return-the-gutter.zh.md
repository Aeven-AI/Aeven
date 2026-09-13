# Agent Note: 覆盖式滚动条把槽位还给滚动视口

Status: implemented

[English](2026-09-13-overlay-scrollbars-return-the-gutter.md) | 中文

## 问题

Web 客户端里每个滚动盒子都把自己的 8px 宽度让给了滚动条，而 transcript（文本记录）恰恰在最显眼的地方丢掉它。`ConversationRoot` 的滚动视口用 `scrollbar-gutter: stable` 无条件预留了这条带子，消息列在收窄后的盒子里居中，composer 座位与 `.viewChrome` 则用 `--dsh-scrollbar-width` 把这条带子买了回来，好让输入卡片留在列的轴线上。本次改动之前在运行中的 GUI 上实测（chromium 151、macOS 26.5）：`.scrollBody` 报出 `offsetWidth - clientWidth` = 8、`scrollbar-gutter: stable`、`scrollbar-width: auto`。

这条带子属于皮肤，而不属于调色板。[主题化滚动条与预留槽位](2026-07-28-themed-scrollbars-and-reserved-gutter.zh.md) 把同一份皮肤拆到两条渲染路径上并彼此加门禁隔开——标准属性给不实现 `::-webkit-scrollbar` 的引擎，伪元素给实现了它的引擎——因为 `scrollbar-color` 或 `scrollbar-width` 一旦取非 `auto` 值，chromium 与 Safari 就会丢弃该元素上的伪元素规则，`::-webkit-scrollbar-thumb:hover` 也在其中。这条分界还顺带决定了布局，而那并不是它声明的目的：chromium 之所以把滚动条画在槽位里而不是浮在内容之上，靠的正是 `::-webkit-scrollbar` 的宽度，于是走伪元素路径的引擎（chromium、Safari）每个滚动盒子都要付出 8px，走标准属性路径的引擎（Firefox）则不必。两条路径里只有一条有可能把这 8px 让回来，而它并不是多数读者所用的那一条。这条分界也正是侧边栏列表当初需要预留的原因。

## 决策

`packages/client/ui-theme/src/styles/scrollbar.css` 在 `body, body *` 上无条件声明 `scrollbar-width: thin` 与 `scrollbar-color: var(--dsh-scrollbar-thumb) transparent`，凡是实现这两个属性的引擎都走这条路径。只有这两个属性能够要到一条不占槽位的滚动条：在运行中的应用里于 chromium 151 上实测，把一个滚动容器从先声明伪元素宽度改为只声明这两个属性，`offsetWidth - clientWidth` 从 8 变为 0，而带主题的滑块仍画在内容的内联边缘（从截图中读出为滚动视口右缘一条 11 × 40 设备像素的色带，布局宽度为 0），`scrollbar-gutter: stable` 也没有为取而代之的覆盖式滚动条预留任何东西。取 `thin` 而不是初始值 `auto`，是因为它让滚动条接近伪元素路径画出的 8px；而对仍在预留槽位的引擎来说，它是两种预留中更窄的那一种。

伪元素皮肤并没有被删除，只是移进了 `@supports not (scrollbar-width: thin)`，而该条件恰好对无法遵循标准属性的引擎为真（caniuse 记录的首个支持版本是 chromium 121 与 Safari 26.2，26.0 与 26.1 为部分支持）。这样一来，这些规则的作用范围由这条 at-rule 明说，而不是听凭上文那种静音机制：不加门禁的那份副本会被每一个能解析该属性的引擎丢弃——门禁恰恰是在把这些引擎隔开——在评审时读起来就是死 CSS。两种说法本就一致，因为静音机制所依据的取值，与门禁所检测的是同一组非 `auto` 取值，正因如此一道门禁就够了。

hover token 只在这条回退路径上渲染。`--dsw-alias-scrollbar-hover-l1`／`-l2` 以及每个抬升表面都遵循的成对重绑约定之所以存在，是因为 `::-webkit-scrollbar-thumb:hover` 能指定第二种颜色；而 `scrollbar-color` 只表述一种颜色，hover 表现由引擎自行推导，因此标准属性路径上没有对应的东西可渲染。这组变量仍然保持绑定且可重绑，那条要求每个会滚动的抬升表面都重绑完整一对的样式表约定也仍然为绿，因为回退路径仍然读取这两半——如今漏掉重绑的表面会在那些引擎上出错，在其余引擎上则正确。

`.no-scrollbar` 保留它的两半，且都放在门禁之外。`scrollbar-width: none` 服务能解析该属性的引擎，伪元素 `display: none` 服务不能解析的那些——正是回退皮肤所面向的引擎——因此不需要把任何一半与另一半用门禁隔开。vendored 样式表（`ui-auth-aeven/src/vendor/aeven-auth.css`）为自己的消费方声明了同一个类，且全应用加载，因此两处写法保持一致。

`--dsh-scrollbar-width` 连同它的两个读取方一并删除。预留了槽位的滚动视口，已经没有任何数字可以交给座位：这条预留是对称的，`scrollbar-gutter: stable both-edges`，因此内容列的轴线就是滚动视口盒子自身的轴线，而座位——无论在 Chat 中还是在某个视图的 composer 覆盖之下，它都位于那个盒子之外——无需任何补偿就落在同一条轴线上。以经典 15px 滚动条实测：`stable` 会让居中的子元素偏离盒子中心 7.5px，`both-edges` 则让它正好落在中心；换成覆盖式滚动条时两者预留的都是 0。覆盖视图那条分支保持 `scrollbar-gutter: auto`，因为那个盒子从不滚动，在那里做对称预留只会把视图内容从两侧各收窄一次。

## 曾考虑的替代方案

**保留固定的 8px 补偿，只把标准属性给不实现伪元素路径的引擎。** 否决：这正是当前交付的形态，也正是付出这条带子的原因。而且它无法靠 token 的任何取值修好，因为这条带子在本改动所针对的引擎上是 0，在仍会预留槽位的引擎上则是一个没有任何样式表知道的引擎侧取值。

**只预留末端一侧，并在运行时发布实测到的带子以驱动补偿。** 否决：一个实测得到的自定义属性就是一份新约定——它何时发布、发布在哪个元素上、首次绘制之前座位渲染什么——而它要维持的那份对齐，CSS 用对称就能表达；何况它会继续预留这 8px，而本次改动存在的意义正是把它还回去。

**对称预留加上现有的 8px 补偿。** 否决：两者会重复计算。`both-edges` 已经把列放在盒子的轴线上，再补内边距反而会把卡片推离轴线半个带子的宽度。

**只声明标准属性，伪元素规则不加门禁。** 否决：那样这份皮肤的作用范围就取决于各引擎的丢弃行为，而不是取决于一件可检测的事实；而某个既能解析标准属性、又仍遵循伪元素的引擎，会画出本次改动要移除的槽位。门禁让「哪些引擎拥有这份皮肤」成为一件明说的事实。

**删掉伪元素路径，让回退引擎渲染浏览器自带的滚动条。** 否决：`.no-scrollbar` 恰恰会在这些引擎上不再隐藏滚动条，于是侧边栏会话列表的行会跑到浏览器自带滚动条之下——这正是[2026-07-28 决策](2026-07-28-themed-scrollbars-and-reserved-gutter.zh.md)所针对的症状——而 hover token 会失去最后一个消费方，进而把成对重绑约定从客户端每一个抬升表面里抽走。

**保留这条带子，把它写进文档。** 否决：它让每个滚动盒子都少 8px，而 transcript 与它的 composer 正是读者看得见的地方——列与输入卡片一起偏在盒子中心左侧 4px 处，而这正是补偿所换来的东西。

## 后果

- 在实现标准属性的引擎上，没有任何滚动盒子再为滚动条预留宽度。在被报告的那套配置里，1400px 视口内 transcript 滚动容器的可用宽度从 1112px 变为 1120px，它的列与 composer 卡片都从 836 重新居中到 840，而座位不需要任何内边距就落在这条轴线上。
- 滚动条仍被绘制、仍有主题、仍由引擎在 hover 时加粗；变的是它画在内容之上，而不是内容旁边。完全不想要滚动条的表面照旧写 `.no-scrollbar`，如今在 chromium 上与在 Firefox 上一样经由标准属性生效，这也让侧边栏的列表与 composer 的各覆盖层在各引擎间保持一致。
- `scrollbar-width: thin` 是一个请求，而不是一次测量：绘制经典滚动条的引擎仍会把该滚动条的宽度从滚动盒子里扣掉——只是比 `auto` 的滚动条更窄——而那里的 composer 之所以仍留在 transcript 的轴线上，靠的正是对称预留。只有把滚动条画成覆盖层的引擎才会把整条带子还回来；在 macOS 上，chromium 对初始滚动条样式所画的也正是这种覆盖层：那 8px 是 `::-webkit-scrollbar` 皮肤造成的，而不是平台造成的。
- WebKit 会一直保留占布局空间的带主题滚动条，直到 Safari 26.2 带来标准属性；在那里，对称预留让 composer 仍留在 transcript 的轴线上（WebKit 从 Safari 18.2 起实现 `scrollbar-gutter`）。既没有实现标准属性、也没有实现 `scrollbar-gutter` 的引擎——Safari 18.2 之前——会让 transcript 相对 composer 的居中最多偏离回退滚动条宽度的一半（4px），因为此前覆盖这一情形的补偿已经没有了。这里选择接受，而不是继续背负：token 唯一能取的取值，恰恰是在其余所有地方都错的那个。
- 样式表约定随决策一同移动：`scrollbar-styles.client.spec.ts` 现在钉住门禁之外的标准属性、门禁之内的皮肤与每一处对 hover 间接变量的读取，以及门禁之外 opt-out 的两半；`scroll-surface-styles.client.spec.ts` 则钉住对称预留，以及座位与视图 chrome 两侧都不再有补偿。

## 测试

`packages/client/ui-theme/tests/scrollbar-styles.client.spec.ts` 把样式表当作文本来读，并以源码偏移量钉住这一划分，因为它的规则解析器会把 at-rule 拉平：删掉门禁、或把某条声明移到门禁另一侧，文件里其余全部断言仍然是绿的。它还保留了[2026-07-28 决策](2026-07-28-themed-scrollbars-and-reserved-gutter.zh.md)引入的 token 消费方、成对重绑与抬升表面检查。`packages/client/ui-conversation/tests/scroll-surface-styles.client.spec.ts` 钉住对称预留、座位不再有 `padding-right`，以及视图 chrome 的对称内缩。

这些布局结论是实测出来的，不是推导出来的，因为决定它们的两件事都是引擎行为：带子（同一个滚动容器上从 8 变为 0，并有截图确认滑块画在内联边缘、像素带在滚动视口右缘宽 11 × 40 设备像素）与居中（经典 15px 滚动条分别配 `stable` 与 `stable both-edges`，偏离盒子中心 7.5px 对正好落在中心；换成覆盖式滚动条时两者都是 0）。

`apps/web/tests/composer-tab-geometry.e2e.ts` 在真实浏览器里覆盖同一套几何，并把它记录进 `expected/composer-tab-geometry/geometry.expected.md`，该文件如今读出的是 `stable both-edges` 与 0px 的带子。它的对照——即等矩形断言仍然可能失败的那个断言——为本次改动重建过：样式表里已经没有补偿，强行恢复旧补偿不会移动任何东西，因此对照改为在 Chat 的滚动视口上声明一条占布局的滚动条，并去掉它的预留。
