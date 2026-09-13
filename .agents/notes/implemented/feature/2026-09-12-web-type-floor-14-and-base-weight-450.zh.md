# Agent Note: The Web Type Floor Moves to 14px and the Base Weight to 450

Status: implemented

[English](2026-09-12-web-type-floor-14-and-base-weight-450.md) | 中文

## Problem

Web UI 上有两项字体默认值来自 Figma 导出，而不是出自针对产品本身的决定。最小的文本档位是 13px：41 个样式表里有 77 处直接写出该值，另有 10 个样式表里的 29 处读取导出的 `--dsw-font-xs-13` 令牌，于是大部分小字号文本只比 14px 正文小一像素——近到读不出自成一档，小到像是失误。文档字重则是用户代理样式表给什么就是什么，因为只有 Markdown 阶梯与内置的 Aeven 样式表显式写明了字重。随包发布的可变字重字体会把 450 渲染为真实实例，且设计本身已在用它，因此未声明字重的文本成了产品唯一回退到 400 的地方。读者看到 13px 文本紧挨着 14px 文本、400 紧挨着 450，会把这种混杂读成渲染缺陷，而不是一套字阶。

## Decision

没有任何 Web 源码声明 13px 字号，基础字重为 450。两条规则覆盖每一个带浏览器半部的包——52 个声明 `dsh.client.platform === 'web'` 的包，加上 `apps/web`——即 101 个样式表以及它们旁边的内联样式对象，因为部分插件包以 CSS-in-JS 而非规则来写这些界面。

字号改动不是文本替换：导出的 `--dsw-font-xs-13` 与 `--dsw-font-xs-strong-13` 档位改名为 `--dsw-font-xs-14` 与 `--dsw-font-xs-strong-14`，并声明为 `14px/20px` 与 `500 14px/20px`，使令牌名、其取值与 39 处消费方三者一致。行高刻意保持 20px 不变：该档位正是密集档，字形大 1px 可保住消费它的行高——轨迹表、终端、读取、diff 与网页块。

字重改动覆盖 400 的三种写法——两个包组共 52 处声明——因为样式表有三条路径到达它：`font-weight: 400`、`font-weight: normal`（highlight.js 那些把加粗默认值重置掉的令牌规则），以及 `font` 简写内部的 `400`。它还覆盖完全不声明字重的声明——12 处组件 `font` 简写与 16 个复合字体令牌——因为 `font` 简写会把省略的字重重置为 `normal`，不处理它们，就等于恰好在使用简写的那些密集界面里保留 400。随后 `packages/client/web/src/base.css` 把 450 设为 `body` 的文档默认值，并在 `button`、`input`、`select`、`textarea` 上重申，因为它们的用户代理简写会同时重置字族与字重。

派生档位遵循同一条规则。`--dsh-content-font-size-secondary`——流式行、聊天的次级行与 Markdown 表格所读取的那一档——原先在样式表里由 `min(设置值 − 1px, max(13px, 设置值 − 2px))` 计算，在设置为 14 与 15 时会解析为 13px。任何 `min`/`max` 组合都无法在阶梯中间跳过单一取值，因此该映射移到 `src/theme-settings.ts` 的 `secondaryFontSize`：低于 14 时取设置值 −1，14 与 15 时守住 14 下限（再降一级就会落到 13px），16 及以上取设置值 −2。其结果与 `fontSize` 一同搭载在主题快照上，因为 bundle 纯净度门禁禁止 ui-layout 的客户端 bundle 从 ui-theme 做值导入；`boot-theme.ts` 的启动脚本在任何插件运行前就发布同一对变量，`ThemePresenter` 在每次快照时发布，样式表中只声明会被它们覆写的回退值。

作为字重而非文本样式的标注保留原值：ANSI 渲染器的 `bold: { fontWeight: 700 }`、`600` 强调字重，以及内置 Aeven 样式表自有的字阶都照旧。

## Alternatives considered

**只替换字面的 `font-size: 13px` 声明。** 否决：那会留下导出令牌的 39 处消费方仍是 13px，而可见的密集文本大多在那里——轨迹表、终端、读取、diff 与网页块读的都是令牌，不是字面值。

**保留令牌名，只改其取值。** 否决：那样 `--dsw-font-xs-13` 会声明 14px，下一位读者就得逐个检查令牌本体才能知道哪些名字在说谎。

**把该令牌的消费方改为相邻的 `--dsw-font-s-14` 档。** 否决：那一档带 22px 行高，凡是读它的密集行都会长高两像素，把一次字号改动变成跨轨迹表与工具卡片的布局改动。

**只靠 body 默认值处理字重。** 否决：`font` 简写会重置省略的字重，于是密集组件的简写与复合令牌会继续渲染 400，而 UI 其余部分已移到 450——正是本次改动要消除的那种混杂，且恰好出现在读者最常看的地方。

**从 ui-theme 的 client 入口把该映射导入 presenter。** 被客户端 bundle 纯净度门禁否决：跨插件的值导入会让构建失败；而把 ui-theme 声明为 ui-layout 的显式 external，则会把主题插件的代码塞进每一个读取字号的 bundle。主题快照本就跨越服务接缝承载已解析的主题状态，因此这一档随它一同传递。

**保留样式表中派生的档位，接受两个设置下出现 13px。** 否决：那是唯一仍会渲染 13px 的路径，而且渲染的正是读者最常遇到的那一档——流式行、聊天的次级行与 Markdown 表格——于是本次改动声明的字号下限会对声明成立，却对声明本要服务的文本失效。

**把表单控件设为 `font-weight: inherit`。** 否决，改用字面值 450：这里要的是一个固定的基础字重，而继承会让某个加粗祖先把控件标签拉到一个组件从未选择的字重上。

## Consequences

各样式表声明的字阶为密集档与正文的 11、12、14、16，之上是 Markdown 标题各档：让小型文本显得像失误的那 1px 差距消失了，最小的密集档现在也带上正文自身的字重，于是密集文本读起来是 14px 的文本，而不是被缩小的文本。代价真实但有限。密集令牌在 14px 字形上仍是 20px 行高，比正文 16px 配 24px 更紧，因此消费它的界面比其余部分略密；这是该令牌在本次改动前自己的选择，本次未改。在字号设置 14 与 15 下，派生档位现在等于正文字号而不再低一像素，因此这两个设置只有一档字号，而阶梯的其他设置有两档，且只有标签颜色把流内行标题与周围的正文文本区分开。更重的基础字重还使 500 成为第一个读起来像强调的档位，因此任何依赖密集文本中 400 与 500 对比的设计如今对比更弱——当前发布的样式表里不存在这类规则，而将来若要有，必须显式写出 400，并且因为在审查中它已是例外而不再是默认，所以一眼可见。

## Verification

`packages/client/ui-theme/tests/theme-settings.client.spec.ts` 锁定该档在全部可接受取值上的阶梯、它永不返回 13、且永不超过正文字号；`boot-theme.client.spec.ts` 与 `packages/client/ui-layout/tests/theme-presenter.client.spec.ts` 锁定两个写入方都从同一字号成对发布并在 dispose 时撤回。`packages/client/ui-chat/tests/chat-font-axis-styles.client.spec.ts` 与 `packages/client/ui-workflow-run/tests/panel-styles.client.spec.ts` 锁定读取该档的规则。`pnpm exec vitest run packages/client packages/session-query packages/extensions` 通过（386 个文件，5,541 个测试）。对全部 890 个 UI 源文件——52 个包与 `apps/web` 中的样式表与内联样式对象——扫描 `font-size: 13px`、`fontSize: 13`、`font-weight: 400`、`fontWeight: 400`、`font-weight: normal`、`--dsw-font-xs-13` 以及未声明字重的 font 简写，各项均为零。客户端库与 Web 产物已重建，对运行中的 Web UI 做实时扫描显示渲染字号为 12px、14px、16px，字重为 450、500、600——没有任何元素处于 13px 或 400，`body` 计算值为 450，且 `body` 成对携带两个正文字号变量。
