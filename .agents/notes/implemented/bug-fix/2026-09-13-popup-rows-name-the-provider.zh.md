# Agent Note: 弹窗行显示提供方名称，并以高亮标记选中

Status: implemented

[English](2026-09-13-popup-rows-name-the-provider.md) | 中文

## Problem

`popupSelect` 的一行会渲染自己的 `label`、可选的 `detail`，以及调用方标记为 `active` 的那一项上的对勾图标。在模型列表中，detail 是 `group.name · model.description`，而图标正是从同一行里夺走宽度。来自运行中 GUI 的反馈：DeepSeek 的行显示为 `DeepSeek · Fast, efficient, and economical; suited to focused, routine, or parallel tasks. Reads images.`，而 OpenRouter 的行只显示 `OpenRouter`，因为 `llm-deepseek` 的目录为每个模型都公布一段说明，OpenRouter 的目录则一段都没有。于是同一个选择器在不同提供方下读起来并不一致，而当前行上的对勾图标又把 detail 行压窄，直到被截断掉的恰好是提供方名称。

这个图标本来也是多余的。[两个入口共用一个模型选择器](../architecture/2026-09-12-one-model-picker-for-both-entries.zh.md) 已经让外壳把高亮落在调用方标记为 `active` 的行上，并把该行滚入视野，因此图标所标记的行，正是已经披着悬停底色的那一行。

## Decision

模型行的 `detail` 只显示提供方分组名称。目录说明移入新增的可选字段 `SelectOption.keywords`：`filterOptions` 匹配它，而 `PopupSelectView` 从不渲染它。于是输入说明中的词仍能找到对应模型，而一整句说明不再与提供方名称争抢该行的宽度。

`PopupSelectView` 不再渲染对勾图标，`.check` 与其 `IconCheckOutline16` 导入一并移除。调用方标记为 `active` 的那一行改为常驻承载悬停底色作为选中标记：`rowSelected` 与滚过时的 `rowActive` 共用同一条声明，于是当前值始终保留指针给它的那种观感，而该行把宽度留给 label 与 detail。

这次约定变更是纯增量：`keywords` 为可选字段，其他贡献项的行不受影响。

## Alternatives considered

**彻底去掉说明，既不显示也不搜索。** 之所以拒绝：这是用悄悄移除一项已有能力的方式去修显示问题——[README 的约定段落](../../../../packages/client/ui-commands/README.zh.md) 明确写着搜索会匹配 detail 文本，而模型列表正是人们真正会去输入的那个选择器。

**保留对勾，让 detail 行省略号截断。** 之所以拒绝：那正是被报告的缺陷。detail 承载的是提供方名称，而用一个图标去标记一行高亮已经标记过的行，是把行宽花在了错的地方。

**只让打开时的高亮充当标记。** 这是本改动的第一版，随后在看到界面后反转：图标移除后若只由光标承载选中，鼠标一移向别的模型，当前行的底色就被清掉，选择器读起来像没有选中值。因此改为由标记常驻承载该底色；代价是在指针停在别处时，「指针所在行」与「选择器当前值所在行」会是两行同时带底色——这是该行接受的取舍：两种事实共用一种观感，靠存在时长而非第二种色调来区分。

**把说明放进 label。** 之所以拒绝：label 是无障碍名称与排序键，一整句说明会同时撑大两者，而且每一行仍然会因为提供方不同而读起来不一样。

## Consequences

- 每个模型行都读作「模型名 + 提供方」——`DeepSeek-V4-Pro` / `DeepSeek`——无论提供方是否公布说明，形状都相同，剩余宽度归提供方名称所有。
- 说明仍然可搜：`keywords` 参与 `filterOptions`，却从不进入 DOM，因此任何选择器都无法把只用于搜索的文本泄漏到行里。
- 指针与方向键移开后，当前值仍保持标记。常驻标记与滚过底色是同一条声明而非两种色调，因此在指针离开时，一个带当前值的选择器会显示两行带底色的行——这是有意接受的：另一种做法是让持有值的选择器看起来像没有选中值。
- 两个 `popupSelect` 表面失去了对勾图标：模型列表与推理强度列表，它们共用同一个外壳。两者都由 composer 模型位或 `/model` 打开，且都会高亮原本会带上该图标的那一行。
- 行约定新增一个可选字段，记录于[单选择器笔记](../architecture/2026-09-12-one-model-picker-for-both-entries.zh.md)以及 `ui-commands`、`ui-model-selection` 两个 README。

## Testing

`packages/client/ui-commands/tests/popup.client.spec.ts` 固定了 `filterOptions` 会像匹配 label 与 detail 一样、不区分大小写地匹配 `keywords`。`packages/client/ui-commands/tests/popup-view.client.spec.tsx` 固定了渲染结果：被标记的项带 `aria-selected` 且不含 `svg`，而按关键词搜索会过滤到该行，同时只渲染其 label 与 detail——若视图开始渲染 `keywords`，这条断言就会失败。另一条用例用 `ArrowDown` 移动高亮，断言被标记的行仍带 `rowSelected`，而 `rowActive` 已移到下一行——若标记退回由光标承载，这条就会失败。`packages/client/ui-model-selection/tests/browser-plugin.client.spec.ts` 固定了模型行本身：带说明的模型其 `detail` 为 `'DeepSeek'`，说明则位于 `keywords`。

Web e2e 套件通过 `aria-selected` 读取当前行，因此仍然原样固定打开时的高亮，且没有任何 golden 记录了该图标或说明。
