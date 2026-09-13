# Agent Note: 冷会话在列表中就带着标题

Status: implemented

[English](2026-09-13-a-cold-session-is-listed-with-its-title.md) | 中文

## Problem

导航里的会话行偶尔显示为 `project`——该会话工作目录的 basename——而不是名称，刷新页面后名称又回来了。显示链路是 `displayTitleOf(title, cwd, id)`（`packages/api/session-controller/src/client/sessions/service.ts`）：持久标题，其次 cwd basename，最后才是原始 id。所以 `project` 从来不是丢失的名称，而是「客户端认为这一行没有标题」时的回退值。

追查后发现两个不同原因：

- **从未收到任何消息的会话。** 它们的日志只有 `session`、`permission/preset`、`sandbox/mode` 与 `approval/policy`——没有任何 `user/message`，因此标题生产者从来没有输入（标题来自一条合格的 `user/message`：LLM provider，或确定性的「首句前几个词」回退）。126 个缓存会话中有 9 个处于这种状态。它们会一直显示 basename，不是本笔记的主题。
- **有标题、却被列成无标题的会话。** 来自运行中 GUI 的反馈，并在代码中复现：行的标题读自客户端的按会话 projection store，其数据来源是控制基线（已附着的会话）、实时 `projection` 帧以及一次列表拉取。对一个**冷**会话——出现在列表里但未附着到 agent——只有列表拉取能带上它，而那次拉取用的是 projection 缓存的 hint 块。这些 hint 按设计就是残缺的：只有版本匹配的 wire cell 会留存（`projectionsFor` 的注释：「Listing hints contain every currently cached wire value but remain partial: missing cells and cache rows are never materialized here」）。于是一条「已缓存、非空白」的行，其块里有 `sessionListMetadata` 却没有 `title` cell，就绕过了原有的完整性判断——那个判断只问这一行是不是 *blank*——被无名地列了出来。点击该行会附着会话并物化标题；刷新会重新拉取列表——这正是两者都能让名称出现的原因。

## Decision

`ApiSessionList.summarizeCold` 把「没有 title cell 的 hint 块」视为不完整，并执行它本来为 blank 情形准备的有界冷观测（`probeSmallCold`：在工件小于 `coldBlankProbeMaxBytes` 时做一次 `observeSession`，单会话失败被容忍并记录）。新增的 `coldHintsComplete` 明确了一行到底需要什么：`sessionListMetadata.blank === false` **且**存在 `title` 字符串。blank 行仍然什么都不需要——导航用本地化的「新建会话」文案标注它——而探测不可用的行（工件过大、无持久化、读取失败）保持原行为，回退到已缓存的块。

客户端未作改动。最初写过一个客户端自愈——当无标题的行发生变动时重新拉取列表，带去抖与按会话的预算——随后撤回：它在猜测一次拉取要多久，只能治那些之后恰好有变动的行，并且掩盖了一个回答本就不完整的宿主。宿主回答完整之后，页面加载、重连以及此后任何一次列表拉取都会带上标题，而页面打开期间才出现的标题则会通过实时会话本就广播的 projection 帧抵达该行。

## Alternatives considered

**由客户端按定时器或按行的活动重新拉取列表。** 如上撤回：它在错误的方向上无界（永远拿不到标题的会话会一直发问），又在另一个方向上受限（没有后续活动就出现的标题永远治不到）。宿主知道它有没有标题；客户端只是在猜。

**每次列表都为每个冷行从日志折叠标题。** 之所以拒绝：每行每次拉取都读一遍正文，正是 projection 缓存要避免的事。探测仍受 `coldBlankProbeMaxBytes` 约束——那恰好是可接受读正文的大小。

**改为显示本地化的「未命名」标签，而不是 cwd basename。** 对这个缺陷没有必要——出问题的行其实有标题，如今也显示出来了。对真正没有标题的会话，那是另一个问题；在那里 basename 至少是真的。

**把标题放到 projection 块之外（专用 summary 字段）。** 之所以拒绝：标题本来就是 projection，`titleProjectionDefinition` 已经声明了它的 wire 视图，再加一条通道就得与它同步。问题在于块不完整，而不是形状不对。

**保持 hint 块原样，让客户端按会话去问。** 之所以拒绝：wire 上没有按会话读取 projection 的接口，而且每个客户端都得实现同样的修补。

## Consequences

- 有标题的冷会话在本次改动后的第一次拉取就带标题出现，无需点击、无需刷新。此前因缓存丢了 cell 而显示 basename 的行，会在列表再次被拉取时立刻变得有名字。
- 从未收到消息的会话仍显示 cwd basename：它们没有标题可显示。它们的标签是另一个决定（可以用本地化的「未命名」标签替换）。
- 冷列表现在会为「非空白且缓存缺少 title cell」的行多做一次有界观测。这个集合很小且属于历史遗留（cell 存在之前写入的缓存，或被版本闸门作废的缓存），而该探测正是 blank 情形本就在跑的同一个，受同样的字节预算约束；探测无果的行保留其缓存 hint。
- 对已附着的会话没有任何变化：它们本就通过 `summaryFor` 的实时快照带着标题。

## Testing

`packages/api/session-controller/tests/session-cold.host.spec.ts` 固定了它：一条冷会话，其缓存 hint 含 `sessionListMetadata` 但没有 `title`，日志中带有一个 `session/title` 事件，会被列成带标题的行——该用例在旧的完整性判断下失败，报 `expected undefined to be 'Fix the sidebar labels'`。同一 spec 里 cached-non-blank 的 fixture 现在带上了 title cell，这表述了规则的另一半：完整的 hint 不会被重读，其检查次数仍为三次。`manager.client.spec.ts` 保持客户端自身约定不变——被撤回的自愈用例随之一并移除。
