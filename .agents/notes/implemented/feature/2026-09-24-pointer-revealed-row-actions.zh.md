# Agent Note: 行操作由指针或键盘揭示，选中时不揭示

Status: implemented

[English](2026-09-24-pointer-revealed-row-actions.md) | 中文

## Problem

侧栏的每一行都把控件收在一个尾部单元格里——文件夹行的 New Session 按钮与 Session 行的选项菜单——而 [`WorkspaceBrowser`](../../../../packages/client/ui-workspace/README.zh.md) 在静止时隐藏该单元格：`.rowActions` 声明了 `opacity: 0` 与 `pointer-events: none`。让该单元格回来的那套揭示规则按行种类分别写出，只应答指针与该行自己打开的菜单（`.projectRow:hover`、`.sessionRow:hover`，以及两个 `.menuOpen` 选择器），于是键盘读者没有进入它的路径：`pointer-events: none` 并不会把按钮移出 Tab 顺序，也没有任何选择器会在其中某个按钮获得焦点时揭示该单元格。同一个单元格还带着一处只对文件夹行生效的 `height: 20px` 覆盖，于是同一个单元格落在两种行里就有两个高度。

选中是另一半。被选中的 Session 行不着色——`.sessionRow.selected` 声明的是透明背景——其前导标记也停在静止时的墨色，因此行内没有任何东西说明当前窗格显示的是哪个 Session：该标记只在悬停、或该行自己的菜单打开时才亮起。

## Decision

两种行共用同一份揭示列表：`.projectRow:hover .rowActions`、`.projectRow.menuOpen .rowActions`、`.sessionRow:hover .rowActions`、`.sessionRow.menuOpen .rowActions` 与 `.rowActions:focus-within` 都设为 `opacity: 1` 与 `pointer-events: auto`。选中不在这份列表里，样式表中也不存在 `.sessionRow.selected .rowActions` 规则：被选中的 Session 行，其选项菜单要等指针、该行自己打开的菜单或焦点来要求时才出现。

选中改为由前导标记承载。它是一枚素圆（`IconLucideCircle`），静止时 `opacity: 0.1`，`.sessionRow.selected .idleMark` 把它提到 `1`，与既有的悬停、菜单打开、搜索结果命中三处揭示并列。因此，说明当前窗格显示的是哪个 Session 的，正是这枚着墨的圆，操作单元格不参与这个回答。

`:focus-within` 落在操作单元格上而不是行上，这一位置是刻意为之。在「点击链接即赋焦点」的浏览器里，一次普通指针点击之后焦点会停在 Session 行自身的链接（`.sessionLink`，即该行的 `<a>`）上，因此放在行上的选择器会在该链接持有焦点期间一直让操作显露；放在单元格上时，只有真正落到某个操作上的焦点才会揭示它。

该单元格始终保有自己的空间，只是淡入：`.rowActions` 新增 `transition: opacity 150ms var(--ds-ease-in-out)`，因此一次揭示永远不会重新测量它旁边的标题。删掉只对文件夹行生效的 `height: 20px` 覆盖无需任何补偿——`.iconButton` 是固定 18px 的盒子，装在一个行内 flex 单元格里，而行是固定高度并居中其子项的，因此那处覆盖只是让单元格比它装载的图标高 2px。

## Alternatives considered

**把 `:focus-within` 放在行上而不是单元格上。** 否决：在「点击链接即赋焦点」的浏览器里，一次普通指针点击之后焦点会停在 Session 行的链接上，因此行级选择器会在该链接持有焦点期间一直让操作显露，而揭示也不再意味着「指针就在这一行上」。

**用 `:has(:focus-visible)` 揭示。** 否决：`packages/` 与 `apps/` 下没有任何样式表使用 `:has(`，而它多区分出的那种状态——并非由键盘可见地驱动的焦点——在侧栏里并不存在；单元格上的 `:focus-within` 已经把揭示限定在持有焦点的那个操作上。

**让文件夹行的 New Session 按钮无需指针也停在屏幕上。** 否决：一种行把某个操作永久摆在屏幕上、另一种行却藏起自己的操作，等于让同一份列表拥有两套发现规则。该按钮的可访问名已经点明了它要在哪个文件夹里新建 Session，文件夹行的悬停卡片也会重复该 Workspace 的路径与创建时间，因此这个操作的含义并不依赖按钮一直画在屏幕上。

**选中 Session 行时一并揭示其操作。** 否决：那会在读者本来就在看的那一行上把选项摆出来，而那里恰恰是指针最可能停留的地方，并且会与如今用以标明选中的圆形墨色相争。样式测试锁定了该规则的缺席，因此后续改动无法悄悄把它加回来。

## Consequences

- 两种行由同一次揭示覆盖：指针停在行上、该行自己打开的菜单，或焦点落进操作单元格。被选中的 Session 行不会自行揭示任何东西，样式表中也没有 `.sessionRow.selected .rowActions` 规则。
- 选中由前导圆读取——静止时 `0.1`，行被选中或悬停时 `1`——因此文件夹行的 New Session 按钮是按需揭示，而不是常驻绘制。只有在指针、该行菜单与单元格焦点都不再是通往它的可发现路径时，常驻显示才会回来：一个只靠触摸操作的侧栏，或是一份必须让读者明白「不指向某一行也能从文件夹开始一次对话」的列表。该规则归 `Rows.module.css` 所有，由 `browser-styles.client.spec.ts` 锁定，因此回到常驻显示只需改一个选择器，外加那个用例。
- 一次揭示不产生任何布局代价：单元格保持自身宽度，以 150ms `var(--ds-ease-in-out)` 淡入；删掉的仅文件夹行高度只改变了该单元格自身的盒子，而它所在的行是固定高度。

## Verification

`packages/client/ui-workspace/tests/browser-styles.client.spec.ts` 把 `Rows.module.css` 当作文本读取，并锁定这套揭示：`.rowActions` 为 `opacity: 0` 与 `pointer-events: none`；`.projectRow` 与 `.sessionRow` 在 `:hover` 与 `.menuOpen` 下为 `opacity: 1` 与 `pointer-events: auto`；`.rowActions:focus-within` 同上；而 `.sessionRow.selected .rowActions` 完全没有规则。同一文件中的另一个用例锁定那枚标记——`.idleMark` 为 `0.1`，`.sessionRow.selected .idleMark` 为 `1`。

`npx tsx scripts/run-tsc.ts tsconfig.client.json` 退出码为 0，宿主侧程序同样如此。浏览器半部已用 `pnpm --filter @aeven/client-ui-workspace bundle` 重新构建；产物 `lib/client.js` 在哈希类名下带有这份五选择器揭示列表（`focus-within` 在其中），且没有 `.sessionRow.selected .rowActions` 规则。
