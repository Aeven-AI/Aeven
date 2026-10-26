# Agent Note：会话书签是一条日志事件，而不是 header 字段

状态：已实现

[English](2026-10-26-session-bookmarks.md) | 中文

## 问题

会话日志是一条扁平、只追加的序列，对它自己的若干位置没有名字。客户端可以跳到某个回合（`turnOutline`）、可以搜索日志（`session-query`），但想标记"第一次缓存未命中的那次运行"的用户无处安放这个标记：header 承载的是不得依赖日志内容的元数据，而投影只能折叠事件所记录的东西。

分支已经以"按前缀复制整个会话"的形式存在，`session/rewind` 也已经能在单个会话内隐藏一段区间。两者都没有给会话一种按名字记住某一点的方式。

## 决定

### 一个事件、一个位置，由回放顺序决定

`session/label` 携带 `{ at, label }` 并指向更早的 `seq`。折叠为每个 `at` 保留一行并按 `seq` 排序；同一位置的后续标签替换先前那个，空标签删除该行。一种事件类型同时覆盖设置、重命名与删除，因此不需要联合类型、不需要第二种事件，也不需要 header 字段。

该事件不是 surface 事件：`deriveMessages` 永不会看到它，没有提示由它派生，带标签会话的模型与不带标签的完全相同。正是这一性质让书签可以出现在同时回答通用问题的产品里——对话本身毫无变化。

### 投影是读取侧，动词与 Remote 是写入侧

`@aeven/session-labels` 在 `ctx.sessionProjections` 上注册 `sessionLabels` 单元，于是书签列表通过与回合大纲、会话统计相同的 seam 抵达客户端，共享同一份缓存键与变更流。投递仍属于 seam，卸载插件即移除该键。

`SessionLabelsService.label(session, at, text)` 是唯一的写入路径：它拒绝日志中不存在的事件位置（`SessionLabelTargetError`），按插件的 `maxLabelBytes` 归一化文本，然后追加事件。归一化复用从 `@aeven/session-title` 导入的 `normalizeSessionTitle`，而不是第二份清洗器：两种文本都是用户自撰、都在单行内渲染，两份相同规则必然漂移。

`session.label` 是 unary Session Remote，与 `rename` 一样解析或恢复普通 Session，返回该位置现在承载的文本与提交的 seq；客户端的 `Session.label` 与之逐一对应。字节预算挂在本插件的 `Config` 上，因为它限定的是本域的文本，因此 web-app bundle 的那一行显式写出 `maxLabelBytes`，而不继承默认值。

### 刻意不做的事

它不是会话树。书签命名某一段会话日志中的一个点；从该点继续已经是 `session.edit`（回退加上改写后的提示）或在那个边界分叉，两者都不需要树形格式。它也不是 header 字段：header 只写一次、向加载器描述会话、且无法回放，而书签是会话生命周期中不断到来的内容。

## 验证

`packages/session/session-labels/tests/projection.spec.ts` 覆盖折叠：空起点、无论标签到达顺序都按时间先后排列、同一位置的替换、以空标签删除，以及两条"状态不变"路径（无关事件，与未删除任何内容的删除）——变更流依赖这两条。`packages/api/session-controller/tests/session-label.host.spec.ts` 通过 Remote 覆盖动词：提交的 `session/label` 事件与其回显 seq、随后由折叠提供的视图、以空白文本删除、字节预算截断超长标签、日志中不存在的位置映射为 `session/label-target-invalid`、负位置映射为 `gateway/bad-request` 而非查询日志、插件未挂载映射为 `gateway/internal`。该包通过类型检查，`gen-config-catalog` 列出了 `maxLabelBytes`，`gen-persistence-catalog` 已在 `KNOWN_SESSION_EVENT_TYPES` 中列出 `session/label`，web-app bundle 在与 `session-turn-outline` 相邻处挂载了该插件并带上其配置。

未覆盖：客户端界面。目前没有随附 UI 调用 `label`，因此没有可运行的浏览器检查，也没有任何录制快照包含 `session/label` 事件。

## 考虑过的替代方案

**在日志之外单独建一个书签存储。** 一份自有的持久索引必须在分叉、回退、导入与删除过程中与日志保持一致，而且除非导出也认识它，否则它不会随导出一起走。对日志本就持有的事件做投影则不需要这些。

**客户端本地存储（IndexedDB 或 localStorage）。** 书签将因此按设备分裂，并在导出或换浏览器后消失，而它的全部价值恰恰是比设置它的那个会话视图活得更久。

**放在 header 字段里。** header 只写一次、向加载器描述会话、且无法回放；理由见上文「刻意不做的事」。

**会话树。** 从某个点继续已经是 `session.edit` 或在那个边界分叉；树形格式会给 `SESSION_FORMAT_VERSION` 增添一次结构变更，只为日志本已支持的导航。

## 影响

书签是一条日志事件，因此它随导出保留、随分叉的前缀复制一起走、通过回合大纲所用的同一投影 seam 抵达每个客户端，并且在没有任何标签时只承担一次折叠。代价写在包 README 里：删除是一次追加而非删除操作、标签依赖一个回退可能隐藏的 `seq`、该 seam 不回答跨会话的查询。它带来的一笔结构性欠账是 `session/label` 属于读取必需（required-on-read），因此不认识该类型的构建会拒绝携带它的日志——这是每个新事件都要遵守的同一规则。
