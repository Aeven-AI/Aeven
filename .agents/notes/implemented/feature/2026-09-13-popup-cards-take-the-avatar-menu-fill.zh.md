# Agent Note: 弹窗卡片改用头像菜单的填充

Status: implemented

[English](2026-09-13-popup-cards-take-the-avatar-menu-fill.md) | 中文

## Problem

Web 客户端把下拉卡片画成不透明盒子：`background: var(--dsw-specific-menu)`——浅色主题下是纯白、深色主题下是 `rgb(36, 36, 36)`——composer 外壳自有的两张卡片带 20px 圆角，且完全没有模糊。而 Aeven 自己的弹窗，也就是头像背后的账户菜单，是一张半透明卡片：在它 vendored 的 tippy `menu` 主题里（`ui-account-aeven/src/vendor/aeven-account.css`）使用 `rgba(255, 255, 255, 0.7)` 叠 `backdrop-filter: blur(4px)`，圆角 30px。

来自运行中 GUI 的反馈指出这两个家族不一致，并以头像弹窗为参照，同时要求确认它的圆角。

针对样式表做的核对结果是：头像弹窗**确实**带 `border-radius: 30px`、`background-color: rgba(255, 255, 255, 0.7)` 与 `backdrop-filter: blur(4px)`——它本来就是被其他弹窗拿来比较的那张半透明 30px 卡片。头像本身是 30 × 30 的盒子、`border-radius: 15px`，未作改动。

## Decision

三处卡片表面采用头像弹窗的配方：

- `border-radius: var(--dsw-aeven-radius-surface)`（30px）。共享的 `Menu` 卡片本就使用该 token；`popupSelect` 卡片与 composer 席位自带的菜单从写死的 20px 改到它。
- `background: color-mix(in srgb, var(--dsw-specific-menu) 70%, transparent)`——把 Aeven 的 70% 填充表达在主题自己的菜单 token 上，于是深色主题得到自己的颜色、alpha 相同，而不是白色。
- `backdrop-filter: blur(4px)`。

阴影仍用本应用自己的：`box-shadow: var(--dsw-elevation-prominent)` 配可重绑的 `--dsw-elevation-stroke-color`，而不采用 Aeven 写死的白色内阴影，因此描边继续跟随主题，主题的 elevation 约定也继续成立。没有新增边框，因此「高层级表面不携带中性边框」这条规则不受影响。

三处表面分别是 `ui-primitives` 的 `Menu` 卡片、`ui-commands` 的 `PopupSelectView` 卡片与 `ui-model-selection` 的 `ModelSelect` 菜单——composer 与设置页打开的下拉共用同一种观感。

## Alternatives considered

**照抄 Aeven 写死的 `rgba(255, 255, 255, 0.7)` 与白色内阴影。** 之所以拒绝：那张表只服务浅色。本应用有深色主题，在深色内容上放一张白卡片并不是同一个设计；token 加 `color-mix` 让两个主题共用一套配方。

**只改反馈里点名的那一个弹窗。** 之所以拒绝：Full access 选择器、模型列表与席位的选择器是同一张卡的三种呈现，而这条反馈本身就是「它们应该像那一个」。留下两个不透明的，会让同一个 composer 里并排出现两种观感。

**在 `ui-theme` 里新增一个半透明菜单 token。** 暂时不需要：同一个填充比例，经由已存在的 token 在每个样式表里表达一次即可，不必为它给主题约定添一个新名字。等第二个表面需要不同 alpha 时，那才是命名的时机。

**保留两张外壳卡片的 20px 圆角。** 之所以拒绝：参照卡片是 30px，共享的 `Menu` 卡片早已通过同一个 token 是 30px，而从席位打开的选择器与那张菜单只隔几英寸。

## Consequences

- 菜单、选择器与席位的卡片变成半透明并带模糊：其背后的内容仍隐约可见，这正是模糊的用意。
- 应用中每一处 `Menu` 都随之改变——设置下拉、工作区菜单、计划菜单、权限选择器与 `popupSelect` 列表。这是有意为之：它们本是同一张卡。
- 文字落在菜单填充的 70% 之上而非填充本身。颜色不变，只有 alpha 变了，而模糊让背景不至于与文字争抢。
- composer 自有的两张卡片从 20px 圆角改为 30px 表面圆角。它们的 8px 内边距、行圆角与阴影均未变。

## Testing

没有任何样式表契约固定这些取值，我也没有新造一个：这是一处表面改动，覆盖这些包的测试套件——包括主题的 elevation 与 token 契约——原样通过（ui-theme、ui-primitives、ui-commands、ui-model-selection、ui-conversation、ui-account-aeven 共 1238 项测试）。机械核验的是运行中的应用确实在提供新规则：`backdrop-filter`、`color-mix` 填充与表面圆角 token 都出现在 `avn web` 为 ui-commands、ui-model-selection 与 ui-conversation 提供的 bundle 中——后者也正是共享 `Menu` 改动触达那个弹窗的凭据。
