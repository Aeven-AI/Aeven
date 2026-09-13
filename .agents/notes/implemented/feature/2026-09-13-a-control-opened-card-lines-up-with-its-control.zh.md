# Agent Note: 由控件打开的选择器卡片与其控件对齐

Status: implemented

[English](2026-09-13-a-control-opened-card-lines-up-with-its-control.md) | 中文

## Problem

`popupSelect` 外壳的卡片定位在 overlay 锚点内——那是 composer 卡片上边缘的一条零高度带——并使用 `left: 0`，因此由 composer 控件打开的选择器从 composer 卡片的前缘开始。对 token 路径（在草稿里输入 `/model`）而言这是正确的锚点：它们属于整个 composer。

对控件而言这是错的锚点。席位自带的选择器是一张与触发器右对齐的卡片，而由该选择器的 Model 行打开的模型列表是另一张卡片——同一个席位的两张卡片指向了不同的边缘，可搜索列表看起来属于 composer，而不是属于打开它的那个按钮。运行中的 GUI 将其反馈为与模型选择器未对齐。

## Decision

`CommandUiContract.openSelect` 接受一个可选的 `anchor` 元素，`PopupSelectController.open` 将其带入打开状态。`PopupSelectView` 在挂载后、绘制前，用卡片自身的 offset parent（overlay 锚点）与该元素的盒子做测量，并以 `right: <inset>` 与 `left: auto` 定位卡片，使卡片的后缘落在锚点的后缘上。没有锚点时，卡片沿用 CSS 规则与 composer 的前缘。

席位在 Model 行交接时传入自己的触发器元素。用 layout effect 测量，正是为了避免卡片先按 composer 边缘渲染一帧再跳动；`state.anchor`、`state.open` 与加载生命周期都是该 effect 的输入，因为卡片打开期间 overlay 自身的盒子可能变化。

这次约定变更是纯增量：`anchor` 可选，token 路径不传，由草稿 token 打开的任何选择器都保持原有位置。

## Alternatives considered

**让卡片相对锚点居中。** 之所以拒绝：模型列表最宽可达 420px，而席位只有 220px，居中会把卡片顶出窄 composer 的两端；席位自带的选择器本来就是后缘对齐，与之一致才能让两张卡片读起来属于同一个控件。

**把卡片锚定到 composer 列的中心。** 之所以拒绝：那正是 token 打开的选择器已有的做法，也正是被报告的那处错位。

**由调用方传入裸像素偏移。** 之所以拒绝：那样每个调用方都得自己测量、在尺寸变化时重新测量，并且还要知道 overlay 的盒子；卡片本就由外壳持有，它自己能同时测量两个盒子。

**用 CSS 锚点定位（`anchor-name`/`position-anchor`）定位卡片。** 暂时拒绝：它能省掉测量，但本应用所运行的各引擎对它的支持与回退行为尚未确定，而外壳无论如何仍需保留回退路径。

## Consequences

- 由 composer 席位打开的选择器落在该席位之下，与席位自带的选择器卡片共用后缘；由草稿 token 打开的选择器保持 composer 的前缘。
- 偏移只在每次打开时测量一次，而不是持续跟踪：卡片是瞬时表面，composer 不会在其下方移动——这与 `useAnchoredMaxHeight` 对卡片上方空间所做的假设相同。
- 外壳状态多了一个不可序列化字段：锚点元素。它与 token 段一样，属于打开时的绑定。

## Testing

`packages/client/ui-commands/tests/popup-view.client.spec.tsx` 渲染外壳并断言卡片的内联 `right`/`left` 跟随锚点的后缘，同时断言无锚点打开的卡片保持 CSS 放置。`packages/client/ui-model-selection/tests/model-select.client.spec.tsx` 固定调用方一侧：Model 行把席位自己的触发器元素交给 `openModel`。
