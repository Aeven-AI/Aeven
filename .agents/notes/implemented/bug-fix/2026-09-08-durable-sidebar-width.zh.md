# Agent Note: Durable Sidebar Width

Status: implemented

[English](2026-09-08-durable-sidebar-width.md) | 中文

## Problem

布局 store 只在内存中保存各面板宽度，因此每次重新加载页面都会以 `SIDEBAR_DEFAULT` 重新打开侧栏。用户收起该栏、或把它拖到自己偏好的宽度后，一刷新就全部丢失——而这恰恰是他们唯一刻意设定、并期望再次找到的外壳几何。

## Decision

布局 store 只持久化侧栏宽度，键为 `avn.layout.panels`。关闭的侧栏就是宽度 `0`，因此用户收起的栏重新加载后仍为收起。详情栏宽度与窄视口那一对字段（`narrow`、`narrowExpanded`）保持每页重来：详情栏保留其[默认关闭](../../archived/bug-fix/2026-07-30-web-details-default-closed.md)，只由显式选择重新打开；窄视口那一对是对当前视口的读数，`AppFrame` 挂载时会从 `matchMedia` 重新推导。

只持久化 store 的某个字段是 `avn-client-store` 的一项声明：`persist` 既接受单独的键（整份状态持久化，行为不变），也接受 `{ key, fields }`。带字段列表的回填以 `init()` 的状态为底，仅当还原出的值非 null 且与初始值的 `typeof` 一致时才采用该字段，因此被截断、过期或手工编辑过的条目只会丢掉该字段，而不会污染整个 store。写入只序列化声明出的字段，因此某字段离开持久集合后即停止写入，无需重命名键。

这取代了[详情栏 Session 生命周期笔记](2026-07-29-web-details-session-lifecycle.zh.md)中记录的“store 为瞬时”这一事实；该笔记关于详情栏归属的决定不变。

## Verification

`store.client.spec.ts` 覆盖字段列表只持久化其字段、其余状态在重新加载后回到 `init()`，以及对类型错误、null、缺失或非对象存储条目的拒绝。`layout-store.client.spec.ts` 覆盖侧栏宽度跨重新加载存活、关闭的侧栏重新加载后仍为关闭、详情栏与窄视口那一对不被写入，以及非数值的存储宽度回退到默认值。`app-frame.client.spec.tsx` 逐用例清空存储，使每次挂载都是独立的一次页面加载。

## Alternatives considered

**用一个键持久化整份布局状态。** 它不需要改动框架，但也会恢复 `details`——与已归档的默认关闭决定相抵触——并恢复 `narrow`/`narrowExpanded`，于是在窄视口会话之后于桌面重新加载时，会先画出一帧收起的侧栏，随后才由挂载 effect 纠正断点。

**在 `createLayoutStore` 内手写存储。** 在 `init()` 中读取并订阅实例可以把改动限制在 `ui-layout` 内，但那会在框架实现之外再放一套持久化实现，并且写入发生在 store 声明的 action 集合之外。

**由 `AppFrame` 写入该偏好。** 该 frame 是由三份框架 share 供给的纯组件；把存储 effect 放在那里，会让偏好的归属被 store 与渲染它的组件一分为二。

**给存储键加版本（`.v5` 那种）而不是校验字段。** 那是现有的整份状态惯例，但每次状态变化都要改名，而且同一代次的损坏条目仍会被采用。字段级 `typeof` 校验让这道持久化边界自带检查。

## Consequences

用户离开时的侧栏，就是他们回来时看到的侧栏，且在第一帧即如此——回填发生在 store 构造时、首次渲染之前，因此不会闪烁。每个浏览器 profile 的 `localStorage` 多出一个键。在同一个键下创建的两个存活实例会共享该条目——这正是 `EngineStoreHandle.create` 记录的边界——而生产环境在[框架拥有的 store 生命周期](../architecture/2026-07-22-slot-type-chain-implementation.zh.md)下只创建一个根实例。多次挂载 frame 的测试必须逐用例清空存储，否则某个用例中的收起会成为下一次挂载的起点。
