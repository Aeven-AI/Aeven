# Agent Note: 弹窗卡片采用头像菜单的内描边，且所有弹窗行共用同一个控件单元格

Status: implemented

[English](2026-09-13-popup-rim-and-one-control-cell.md) | 中文

## Problem

在[半透明填充](2026-09-13-popup-cards-take-the-avatar-menu-fill.zh.md)落地之后，针对 Full access 弹窗又报出两处差距。

**缺少那条高光线。** Aeven 的头像弹窗把边缘画成一条明亮的内描边——`inset 1px 1px 0 0 rgba(255, 255, 255, 0.8)` 加上 `inset 0 0 1px 1px rgba(255, 255, 255, 0.8)`——其下再叠一层柔和投影。本应用的卡片则用 `--dsw-elevation-prominent`，而卡片把它的描边重绑到了 `--dsw-alias-border-l1`：浅色主题下是 `rgba(10, 10, 10, 0.04)`。那是一条 4% alpha 的**深色**发丝线——与高光正好相反，且卡片转为半透明后基本不可见。逐一核对两份样式表后确认：这条内描边是真的缺失，而不只是太淡。

**模型弹窗的行是另一种按钮。** Full access 选择器的行是 `ui-primitives` 的 Menu item：40px 的 `--dsw-aeven-control-size` 单元格、8px 内边距、`--dsw-aeven-radius-control` 圆角、14/22。而 `popupSelect` 的行是 6/8 内边距配 8px 圆角、没有最小高度；席位的选择器单元格是 0/10 配 10px 圆角；其推理强度行则是 38px、6/10 配 10px 圆角。同一个家族的卡片，四种尺寸的按钮。

## Decision

`--dsw-specific-popup-highlight` 加入 Aeven 语言表的 `--dsw-specific-*` 组——浅色 `rgba(255, 255, 255, 0.8)`、深色 `rgba(255, 255, 255, 0.08)`——三张卡片各自在自身 elevation 之上画出 Aeven 的两层内阴影：

```css
box-shadow:
  inset 1px 1px 0 0 var(--dsw-specific-popup-highlight),
  inset 0 0 1px 1px var(--dsw-specific-popup-highlight),
  var(--dsw-elevation-prominent);
```

每个弹窗行都采用 Menu 的控件单元格：`min-height: var(--dsw-aeven-control-size)`、`padding: 8px`、`border-radius: var(--dsw-aeven-radius-control)`、`gap: 8px`、`font-size: 14px`、`line-height: 22px`。这适用于 `popupSelect` 的行、席位的选择器单元格（保留 `height`，只是改为同一个 token）以及席位的推理强度行。搜索框的圆角跟随控件圆角；其内边距、外边距与那条发丝线保持不变。

## Alternatives considered

**把 `--dsw-elevation-stroke-color` 重绑到更亮的 token，而不是加内阴影。** 之所以拒绝：那条描边是 `0 0 0 0.5px` 的发丝线，其 token 在两个主题间会翻转含义——`border-l1` 在浅色是深色 4%、在深色是白色 6%——而 Aeven 画的内描边在两个主题下都是白色。它们是两件不同的事，深色卡片既想要内描边、也想要发丝线，而不是二选一。

**照抄 Aeven 写死的白色内阴影。** 与填充同理拒绝：深色主题需要自己的 alpha，因此内描边在两个主题块里都是一个 token。

**只对齐行高，保留圆角差异。** 之所以拒绝：一个比邻居更高、内边距更窄、更不圆的按钮，即使高度一致也读起来像另一个组件——这正是被报告的问题。

**让模型列表用比权限列表更紧凑的行。** 之所以拒绝：两者都是同一张卡片里的命令选择器，模型行的真正区别只是它多带一行详情。紧凑这件事 Menu 已经有 compact-list 变体可以命名。

## Consequences

- 三张卡片共用一种边缘处理与一套行几何：30px 表面圆角之内的 40px 控件单元格配控件圆角，其上在 prominent elevation 之上叠一层白色内描边。
- 内描边画在卡片自身盒内，因此布局不动；它叠在 elevation 发丝线之上，而不是取代它——主题的 elevation 约定（`--dsw-elevation-*` 阴影、可重绑的描边、无中性边框）未被触碰。
- 模型列表的行从约 32px 增长到 40px 的最小高度，因此长目录会更早开始滚动。视口、卡片高度上限与宽度行为均未改变。
- `--dsw-specific-popup-highlight` 在 Aeven 语言表的浅色与深色两个块中都已声明，与其他 `--dsw-specific-*` token 放在一起。

## Testing

没有任何样式表契约固定这条内描边、行的度量或卡片填充；主题的 elevation 契约仍然通过，因为卡片保留了 elevation 阴影引用、继续重绑描边颜色，也没有新增边框。ui-theme、ui-primitives、ui-commands、ui-model-selection、ui-conversation 与 ui-account-aeven 的 1238 项测试原样通过。

机械核验的是交付，覆盖运行中应用所需的两半：产出的 `ui-primitives/lib/Menu.module.css` 带上了内描边与 8px 单元格；拥有 Full access 弹窗卡片的 shell `primitives` chunk 提供了两层内阴影与那个 token；ui-commands 与 ui-model-selection 的 bundle 则为模型列表与席位菜单带上了内描边、控件尺寸与控件圆角。
