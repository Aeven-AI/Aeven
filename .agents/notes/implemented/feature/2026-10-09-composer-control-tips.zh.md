# Agent Note: Composer control tips are centred, and the model seat tips instead of opening

Status: implemented

[English](2026-10-09-composer-control-tips.md) | 中文

## Problem

composer 的 icon 控件在悬停时如何报出自己的名字，有两处问题。

model seat（`conversation.input.model`，[@aeven/client-ui-model-selection](../../../../packages/client/ui-model-selection/README.zh.md)）在 `pointerenter` 时打开自己的 Model/Effort chooser，并靠 pointer grace 保持打开，按下只是把它钉住。composer 这一行里其他 icon 圆盘都用共享 tooltip 报出自己的名字——紧邻的 Options 圆盘就是如此——唯独 model seat 的悬停什么都不说明，反而用一张用户并未要求的卡片盖住 composer。想看清这个圆盘是什么、或只是路过它去够旁边的控件，都会抬起 chooser；而 trigger 所陈述的模型名与 effort 只能通过它的原生 `title` 读到，而 composer 其他控件没有一个用 `title`。

这一行的提示还是靠边对齐的：靠前几个圆盘用 `top-start`（attach、model seat、Options 圆盘、recorder 的 cancel），靠后几个用 `top-end`（send、stop、dictate、recorder 的 save）。于是每个气泡都挂在控件边缘上，气泡本体还探到旁边的圆盘之上，指针沿这一行移动时遇到的气泡读起来像是隔壁控件的；而 composer 自己的控件是 40px 圆盘、间距很小，一个短标签只有落在控件中心才读得出「这是这个控件」。

## Decision

trigger 的悬停只显示共享 tooltip，别的什么都不做：`<Tooltip label={t('trigger.tooltip')} side="top" disabled={open}>` 包住该圆盘，与 `ComposerOptions` 包住自己那个圆盘的方式完全一致，于是 composer 的两个 icon 圆盘读起来是同一族。`trigger.tooltip` 是 locale 持有的文案，为这个 seat 命名（`Model & effort` / 模型与推理等级），与 `menu.aria` 为卡片陈述的是同一件事。

卡片在按下时打开，或在 trigger 自身获得焦点时打开以承载 seat 的键盘路径；关闭发生在它之后的再一次按下、卡片外的按下、焦点离开，或 Escape。由于 trigger 的焦点会在同一次按下的 click 之前打开卡片，那次 click 是「认领」卡片（`claimed`），而不是被读成关闭它的那一次按下；每次关闭都会清掉认领。这个 seat 的悬停打开路径及其 pointer grace 已移除——seat 上的 `onPointerEnter`/`onPointerLeave`、`usePointerGrace`、`openFromHover`，以及抵抗悬停关闭的钉住标记——trigger 也不再带 `title`，因此不会在 tooltip 后面再开一个原生气泡。目录加载随打开一同移动：`load()` 在按下或获得焦点时运行，而不是在悬停时。

composer 控件行上的每一个提示都是 `side="top"`，即把气泡居中于锚点自身的盒：send 与 stop 圆盘（`InputBar`）、dictate 圆盘与 recorder 的 cancel/save 控件（@aeven/client-ui-voice-input）、model seat、Options 圆盘，以及附件托盘里每个缩略图的 remove 控件（@aeven/client-ui-attachment）。attach 圆盘保留 `top-start`，因为它是这一行里唯一一个标签（`Add files and run commands`）宽过 frame 左侧内缩所能容纳的控件：该圆盘是卡片最靠左的控件，居中气泡的一半会落到 frame 的 page inset 之外，引擎把它钳回来，箭头就不再落在字形上。引擎的 `-start`/`-end` 偏移只对靠边对齐的放置生效，因此居中提示不会发生任何滑移。composer 本来就放在更宽一行上方的提示——queue dock 与 skeleton 的导航控件——仍是 `bottom`，居中于各自锚点。

悬停命名的是这个 seat，不是当前选择：生效的模型与其有效 effort 仍然是 trigger 的无障碍名称（`trigger.aria` / `trigger.ariaEffort`）与卡片的第一行，于是 locale 只需为提示持有「这个控件是什么」的一句话，而不是拼出动态标签。

## Alternatives considered

**在 tooltip 之外保留原生 `title`。** 否决：同一次悬停会同时触发两个通道——浏览器自己的气泡晚一秒出现，位置也与 tooltip 不同，而 composer 其他圆盘都不带 `title`。

**保留悬停打开，只把 tooltip 放到更长的停留时间之后。** 否决：会自动抬起的仍然是一张卡片；用户反对的是自动出现的卡片而不是它的时机，而按停留时长分档会让 trigger 的行为取决于用户在上面停了多久。

**让 attach 圆盘的提示跟整行一样居中。** 先做出来、看一眼就回退了：该圆盘是卡片最靠左的控件，标签又是这一行最长的，居中气泡落在它的 40px 圆盘上会越过 frame 的 page inset，引擎把它钳回界内，箭头便不再落在字形上——这一行里唯一一个读起来像没对齐的提示。靠右几个圆盘标签更短（`Send`、`Stop`），居中后仍有余量。

**把整行都改回各自控件的起点对齐。** 否决：行中间那几个圆盘——model seat、Options 圆盘、dictate 圆盘——彼此只隔一个 40px 圆盘，靠边对齐的气泡会把自己的一半宽度花在它所命名的控件之外、盖到旁边的圆盘上，整行读起来像共享气泡而不是一控件一提示。

**逐个控件手工居中，而不是居中于共享的锚点盒。** 否决：`Tooltip` 本来就按锚点盒放置，一个 `side` 就为整行陈述了放置方式；逐控件的偏移会在圆盘尺寸第一次变化时各走各的。

**在 tooltip 里写出当前模型与 effort。** 否决：这会把 trigger 的无障碍名称与卡片第一行的事实再复制到第三处，并且要按 locale 拼接句子；seat 自己的文案说的是这个控件是什么。

**去掉 trigger 的焦点打开，让卡片只由按下切换。** 否决：那样 Tab 到圆盘上将什么都看不到，必须再按 Enter，而这次改动本来要维持一致的键盘路径（press-claim 正是为此存在）会无谓地变窄。

## Consequences

路过的指针不再触发目录加载，也不会在 composer 上画出一张卡片，seat 的悬停代价只剩一个小气泡。chooser 现在需要一次按下或一次键盘焦点才会出现，对刻意悬停的鼠标用户来说比之前多一个手势；tooltip 说明了这个圆盘是什么，所以这个手势是有信息的。卡片打开期间提示被抑制，此时卡片本身已经陈述了这两个值。

这一行里除 attach 圆盘之外的每个提示都挂在它所命名的控件中心，于是指针沿 composer 移动时遇到的是一个圆盘一个气泡，而不是两个气泡在边缘相接。居中气泡在控件两侧各外探一半：在圆盘之间无害，而在 frame 左缘，正是它把 attach 圆盘那个长标签推回了起点对齐。

## Testing

`packages/client/ui-model-selection/tests/model-select.client.spec.tsx` pin 住 trigger 的无障碍名称、它在一次按下前后的展开状态，以及它不带会与 tooltip 竞争的原生 `title`。seat 的卡片行为、effort pane 与选择被拒的 toast 均未改变，保留原有各例。气泡的放置与钳制属于 `@aeven/client-ui-primitives`，由它自己的测试覆盖；composer 侧没有任何 spec 断言提示的 side。

## Related

- [One model picker for both entries](../../implemented/architecture/2026-09-12-one-model-picker-for-both-entries.zh.md) 拥有这个 seat 的两级 chooser 及它向共享列表的交接。
- [Hover popup pointer grace](../../implemented/bug-fix/2026-07-30-hover-popup-pointer-grace.zh.md) 拥有 grace 本身，适用于仍然由悬停抬起的原子组件。
