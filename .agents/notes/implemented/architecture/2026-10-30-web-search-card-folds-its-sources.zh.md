# Agent Note: Web 搜索卡片像已编辑文件卡片那样折叠来源

Status: implemented

[English](2026-10-30-web-search-card-folds-its-sources.md) | 中文

## 问题

`WebBlock` 的搜索卡片把每一个返回的来源都画出来，并用一个 320px 的滚动框限制列表长度。越过滚动边缘之后，读者必须在一个本身就位于可滚动会话中的卡片里滚动，而卡片末尾是一条 `Source list truncated` 提示，它把两件事混在一起：显示被截断（较短的列表同样会滚动），以及工具的 `searchMaxResults` 上限在来源到达客户端之前就丢弃了它们。紧邻它的轮次尾部已编辑文件卡片用折叠解决了同一形状的问题：四行，然后是 `All 8 files` / `Collapse`。

## 决策

搜索卡片的引用列表沿用已编辑文件卡片的行与折叠语法。

- 四行以折叠状态渲染（`FOLDED_SOURCES`），与 `ui-deliverables` 中的 `COLLAPSED_COUNT` 一致；更长的列表在列表下方画一个整宽切换控件，收起时显示 `All {count} sources`，展开时显示 `Collapse`，并带有与那张卡片相同的 chevron、`aria-expanded`、焦点环和粗指针高度。 - 各行采用文件卡片的度量：`padding: 7px 2px`、`min-height: 24px`、label-primary/hover 下 `0.875rem` 的标签、三级元数据。 - 引用序号画在它自己的表格数字列里，而不是 `<ol>` 标记。折叠或展开的行保留真实的、从 1 开始的引用编号，也不会留下滚动容器去裁掉三位数的标记。 - `Source list truncated` 提示被删除，连同它的 `sourcesTruncated` 标签字段以及 en/zh/es 中的 `web.sourcesTruncated` 键。`truncated` 标志保留在结果约定中：它仍然描述工具返回了什么，`web_fetch` 也仍然报告它自己的内容截断。

## 曾考虑的替代方案

- **保留滚动框，只提高 `searchMaxResults`**：报告讲的是读者对列表的体验，而不是数量；更大的上限只是移动滚动边缘，而不是消除它。 - **把全部来源都折叠起来，只在需要时显示链接**：答案会引用带编号的来源，因此最前面的几行必须保持可见，才能与答案一起阅读。 - **在折叠控件旁边保留截断提示**：两件不同的事实变成控件下方的一行，而控件本身已经说明了有多少行存在；这个标志自身的含义——模型从未看到的来源——也不是卡片读者需要据以行动的内容。

## 后果

卡片不再对外声明来源上限。一次搜索是否被截断，只在工具结果的元数据中可见，那是模型的视角；卡片现在只显示列表，不对它作任何说明。`apps/web/tests/web-search-round.e2e.ts` 中的组装浏览器用例断言折叠而不是滚动几何，它的 aria 预期输出需要一次刷新运行。
