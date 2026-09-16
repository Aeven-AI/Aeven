# Agent Note: CSS baseline pairs and breakpoint scope

Status: implemented

[English](2026-09-16-css-baseline-pairs-and-breakpoint-scope.md) | 中文

## Problem

`verify-css-baseline` 将每张客户端样式表都约束在 iOS/Safari 14.5 下限上，而它的两条规则所判定的内容超出了该下限与已记录的尺度本身。

动态视口单位规则按行读取样式表：`dvh`、`svh` 或 `lvh` 声明只有在上一行用 `vh` 重述同一属性时才合法。CSS 没有行语义。下限会丢弃它无法解析的声明，并保留同一属性更早的声明，因此与动态单位写在同一个块中、位于其前的回退值，与写在上一行的回退值等价——而行规则却拒绝了同一行内的配对 `max-height: calc(100vh - 48px); max-height: calc(100dvh - 48px);`，而下限渲染它的结果与预期完全一致。它反而会因为某个为另一属性写下的 `vh` 值恰好位于上一行而予以接受，并且可能把 `dvh` 与来自另一条规则的 `vh` 配对。

断点规则把五档响应式尺度施加到样式表中任意 `(max-width: Npx)` 条件上。该尺度是视口尺度；`@container` 前导测的是元素自身的盒子，属于另一个维度。它的宽度会被报告为超出尺度的断点，并附带「请使用 1284 / 1024 / 768 / 640 / 480 之一」这样的修复建议，而该建议对容器无法执行，同时还重复报告了 `container-query` 条目本已拒绝的 at-rule。

## Decision

当同一属性在同一块的更早声明中已给出静态 `vh` 值时，动态视口单位才合法。`findUnpairedDynamicViewportUnits` 改为通过 `declarationsIn` 读取声明及其所属块，而不是按行读取，并在该块中查找回退值。为另一属性写下的 `vh` 值、位于同级规则中的回退值，以及在一条声明中同时出现两种拼写的值（如 `min(100vh, 100dvh)`，下限会整条丢弃）仍然是违规，且每条违规都指出承载动态单位的那一行。

五档尺度只约束 `@media` 宽度条件。`findOffScaleBreakpoints` 只匹配位于前置 `@media` 前导中的宽度条件，因此 `@container` 前导不在范围内，而每个不在 1284 / 1024 / 768 / 640 / 480 之中的 `@media` 宽度仍会使门禁失败。拒绝该查询本身仍由 `container-query` 条目负责。

## Alternatives considered

**直接封禁 `dvh`。** 表述与检查都更简单，但它会拒绝下限能够正确处理的那种拼写——引擎可解析的 `vh` 声明，其后由更新版本覆盖的动态单位——并且会让两张已经使用该配对的已发布样式表（`DirectoryBrowser.module.css` 与 `RiskConfirmation.module.css`）失败。

**保留行规则，只额外允许动态单位作为本行的第二条声明。** 无需块解析器即可接受同一行内的样例，但会保留上面两处错误结果：上一行为另一属性写下的 `vh` 回退值并不能配对任何东西，而嵌套规则内部的回退值也到达不了该动态单位。

**把尺度施加到所有宽度条件，包括容器查询。** 无论如何容器查询都会被 `container-query` 拒绝，多出的条目只是增加一条作者无法据此行动的重复诊断。

**把尺度规则扩展到非 `px` 宽度（`40em`）。** 这是一个真实缺口——该规则只匹配 `\d+px`，因此 `em` 媒体宽度不受检查——但没有受约束的样式表这样写，而放宽规则会让本次改动并不拥有的样式表令门禁失败。

## Consequences

门禁现在接受下限能够按预期渲染的每一种拼写，并拒绝它不能渲染的每一种拼写，因此作者不再会被推向把同一行内的配对改写成两行。检测器读取的是声明而非行：其代价是对每张样式表多一趟遍历，而其作用域是一个声明块，因此回退值位于自身规则之外的动态单位会被报告，而不是被判为已配对。

`packages/client/**` 与 `apps/web/src/**` 不因该决定而改变：两张已发布的 `dvh` 声明都是两行配对且仍然合法，而每个受约束的 `@media` 宽度本就在尺度之内。

## Testing

`scripts/verify-css-baseline.spec.ts` 固定了以下行为：同一行内的配对被接受；`rejects the value-level features` 样例被拒绝；为另一属性写下的 `vh` 回退值、以及位于动态单位自身声明内部的回退值被拒绝；`@container (max-width: 461px)` 前导仅由 `container-query` 报告。该 spec 保留了行号报告与 `governedStylesheets()` 断言，它们覆盖 121 张样式表。
