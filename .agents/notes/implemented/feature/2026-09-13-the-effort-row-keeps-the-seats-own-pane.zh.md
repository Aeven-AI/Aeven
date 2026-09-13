# Agent Note: 推理强度行保留席位自带的面板

Status: implemented

[English](2026-09-13-the-effort-row-keeps-the-seats-own-pane.md) | 中文

## Problem

[两个入口共用一个模型选择器](../architecture/2026-09-12-one-model-picker-for-both-entries.zh.md) 让 composer 席位的两行都走共享的 `popupSelect` 外壳：Model 行打开 `/model` 注册的可搜索目录列表，Effort 行也通过同一个外壳打开当前模型公布的等级——连同搜索输入。那次统一消除了真实的分叉，对模型列表也完全正确：目录动辄数百行，靠输入说明文字来找是人们的实际做法。

但它对推理强度列表是错的。适配器公布的等级只有三四个（`llm-deepseek` 为 `Off`、`Low`、`High`、`Max`），全部一屏可见，于是外壳的搜索输入成了卡片的第一行，而它能过滤掉的只有读者本来就看着的那几行。来自运行中 GUI 的反馈：打开席位的 Effort 行时，搜索框盖在一屏就能放下的列表上，读起来比这个选择本身更重。

## Decision

Effort 行重新钻入席位自带的面板——Figma 496:26454 的列表行，仍在同一张卡片里，当前生效的等级带尾部对勾，`ArrowUp`/`ArrowDown` 移动焦点，Esc 先退回根层再关闭卡片。没有搜索输入，也没有第二张卡片。Model 行不变：它依旧交给共享外壳，在那里「同一张卡片」正是要点。

真正可能分叉的部分仍然共享：`src/client/effort.ts` 持有 `effortLevelsOf`（面板渲染的等级）与 `effortSelectionOf`（所选等级解析出的选择），`effectiveEffortOf` 则指出当前生效的是哪一档。面板与提交动词都读这同一个模块，因此适配器不提供的等级不可能被渲染，面板渲染出的等级也不可能解析不出来。席位通过新注入的 `selectEffort(levelId)` 提交，而不是通过外壳 spec；被拒绝的选择由席位——而不是外壳——通过锚定在 composer 卡片上的共享 `Toast` 呈现。

`effortPopupSpec`、`effortOptionsOf` 以及外壳侧的努力行 id 被删除，而不是留在原处不用。

## Alternatives considered

**保留外壳，用一个 spec 开关隐藏其搜索输入。** 先试后撤：它让推理强度列表渲染在一张锚定于 composer 卡片（而非席位）的卡片里，带着外壳的空／加载／重试文案与自己的关闭规则，而这个控件的全部职责只是四行。该开关还让共享约定背上了一个其他贡献项都不使用的选项。

**保留外壳与它的搜索输入。** 那正是本笔记所取代的既有状态：对四行做过滤只会把它们藏起来，而输入框要占用 composer 上方一整行高度。

**把等级并进根选择器的行里。** 之所以拒绝：选择器的行集合将取决于当前模型的元数据，而某个公布八个等级的适配器会把 Model 行挤出卡片。

**给推理强度列表单独写一个组件，把统一之前的席位的 CSS 整体搬过来。** 作为复制品拒绝：原来的列表标记值得保留，但它的行与失败表面应当继续读取共享 store 与基础组件——这正是本次是「恢复」而不是「分叉」的原因。面板只有一种行样式、一个对勾与一条提示。

## Consequences

- 席位的 Effort 行打开四个等级，当前生效的一档带对勾，没有搜索输入、也没有第二张卡片；选择某一档保持路由不变、只替换推理强度，与之前一致。
- 席位重新拥有了一份列表——[单选择器](../architecture/2026-09-12-one-model-picker-for-both-entries.zh.md) 消除的分叉在这一份列表上回来了。这是有意的限定：行的派生与选择的解析是同一个模块，而席位这份列表只是四行由适配器提供的名称，没有过滤、没有失败条，也没有需要与模型列表保持同步的空状态。
- 被拒绝的等级不再静默关闭卡片：面板保持打开，共享 Toast 承载 store 的错误文本。
- `/model` 命令与席位的 Model 行不受影响：同一个 spec 对象、同一个外壳、同一份可搜索列表。

## Testing

`packages/client/ui-model-selection/tests/model-select.client.spec.tsx` 固定面板行为：Effort 行就地钻入（不调用 Model 行的打开器），渲染出的等级正是该模型自己的，生效的一档带 `aria-checked`，选择另一档会以该等级的 id 调用 `selectEffort` 并在接受后关闭，Esc 先退回根层，被拒绝的等级让面板保持打开并渲染提示。`packages/client/ui-model-selection/tests/browser-plugin.client.spec.ts` 固定接线：Model 行打开已注册的 spec 对象，Effort 行不在外壳里打开任何东西，`selectEffort` 依据实时快照解析等级并提交保持路由的选择，provider 默认档提交时完全不带 `reasoningEffort`，未知等级 id 被拒绝，而已寻址的 subagent 会话得到拒绝而不是提交。
