# Agent Note: 对话滚动容器退出浏览器滚动锚定

Status: implemented

[English](2026-09-12-transcript-scroll-anchoring-opt-out.md) | 中文

## 问题

切换会话后，对话记录会停在离底部还有一段距离的位置。在运行中的 Web 客户端上，从侧边栏选中另一个会话、再用浏览器历史在 `/c/2cc5bd5e…`（"Overview of new DSH changes since fork"）与 `/c/38c398db…`（"The current performance of this"）之间前进后退，每次都稳定复现，且两个方向都如此：

| 切换动作 | 距底部距离 |
|---|---|
| 打开 `2cc5bd5e` | 0.5 px |
| 从侧边栏选中 `38c398db` | 0 px |
| 后退到 `2cc5bd5e` | 150.5 px |
| 前进到 `38c398db` | 1616 px |
| 再后退到 `2cc5bd5e` | 150.5 px |

每次落点都稳定——偏移此后不再漂移，"回到最新"按钮一直留在屏幕上——所以这不是一个会自行收敛的竞态；历史导航也不是触发条件：同一个会话在本次页面生命周期内被打开过之后，用侧边栏点击切回它同样复现。

`ChatView` 通过一份记录自身写入的账本来掌管该滚动容器的偏移。`onScrollRef` 把没有对应程序化写入的偏移变化视为读者输入（`movedByReader`），而远离底部的读者输入会释放底部跟随：`atBottomRef.current` 变为 `false`，并记录一个 `reflowAnchorRef`；此后两条重新贴底路径——`ResizeObserver` 跟随（`followRef`）与激活尾部校正——都因为要求 `atBottomRef.current` 而不再动作。

在失败切换过程中给所有元素的 `scrollTop` setter 加埋点，只看到两次写入，而它们都无法解释最终落点：

```
toBottom                      assigned 5052 (scrollHeight), applied 4375 (the floor of that moment)
ResizeObserver compensation   assigned 6725, applied 6725   33 ms later
```

激活时的 `toBottom` 在 layout effect 中执行，而此刻对话记录仍在填充，因此它读到的是一个偏短的流：在 `38c398db` 上是 5,052 px，最终为 9,018 px（在 `2cc5bd5e` 上是 6,986 px，最终 14,487 px）。其余行在同一帧稍后落地，随后浏览器滚动锚定为了让自己的锚点节点保持不动，把偏移从 4,375 调整到 6,725——一次 scroll 事件在任何 JavaScript 写入该值之前两毫秒就报告了 6,725。账本看不到这次调整，于是采样把它读成了读者手势，释放了底部跟随，最终记录停在距尾部 1,616 px 处，且再无任何机制去纠正它。在同样流程下于运行时给滚动容器注入 `overflow-anchor: none` 后，每次落点都变成 0 px，由此锁定了这个写入者。

## 决定

两个对话滚动容器都退出浏览器滚动锚定：

- `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css` 中的 `.scrollBody`——承载 `data-conversation-scroll` 的常驻滚动容器，对话列由它掌管滚动。
- `packages/client/ui-chat/src/client/chat/ChatView.module.css` 中的 `.scroll`——没有 `[data-conversation-scroll]` 宿主包裹视图时，由 ChatView 自己掌管的盒子。

CSS Scroll Anchoring Level 1 §2.1 把这一点规定为整个滚动盒子的开关：当生成滚动盒子的元素计算值为 `overflow-anchor: none` 时，该滚动盒子不选取锚点节点；而按 §3，后代滚动容器会为自己的滚动盒子"重新开启"该行为——因此嵌套在对话记录内部的代码块或台账仍保有自己的锚定。

这一退出不会让出任何能力，因为 ChatView 本就会为自己做同样的锚定。远离底部的读者在最近一次被采样的滚动中已记录了 `reflowAnchorRef`，`ResizeObserver` 会在每一次观测到的高度变化（流列与输入框座位）时恢复该行的偏移；停在底部的读者则由 `followRef` 重新贴底。浏览器的调整是对同一属性的第二个写入者，对决定跟随归属的账本不可见，而正是这个写入者出了问题。

## 验证

在运行中的 Web 客户端上通过 CDP，用同一对会话和同一流程（`打开 A` → `选中 B` → 后退 → 前进 → 后退 → 前进）完成复现与修复：

- 改动前：距底部依次为 0、0、150.5、1616、150.5、1616 px。
- 仅在 `[data-conversation-scroll]` 上注入 `overflow-anchor: none`：每一步都是 0 px，确认规范中滚动容器层面的开关已经足够，不需要后代选择器。
- CSS 落地并重建两个客户端包之后（`pnpm --filter @deepseek-ai/dsh-client-ui-conversation bundle`、`pnpm --filter @deepseek-ai/dsh-client-ui-chat bundle`，刷新后由服务端以新的 revision 提供）：每一步都是 0 px，包括对已经打开过的会话用侧边栏点击进入。
- 阅读位置在退出锚定后仍然保持：读者位于距底部 4,000 px 处时，在视口上方插入 700 px 内容后，阅读行在滚动容器中的偏移不变（前后均为 −39 px），距底部距离也不变，说明这种情况仍由 ChatView 自己的重排锚点承担。
- 向上阅读后切换会话，下一次激活仍从尾部开始（0 px），即会话激活滚动策略未变。
- `AVN_SNAPSHOT=replay vitest run --config vitest.web.config.ts apps/web/tests/chat-scroll-contract.e2e.ts` 在未改动的样式表下报 6 个失败，应用本改动后报 5 个。`starts ordinary Session switches at the live tail` 正是本次回归：在未改动的样式表下它距底部差 228 px（`expected 228 to be less than or equal to 1`），应用本改动后通过。其余五个在改动前后同样失败——`preserves the reader anchor when history and streaming arrive concurrently`、`offers every outline turn on the rail and jumps to an unloaded one`、`keeps streaming ownership and tool disclosure state across a long scroll-away cycle`、`restores tab/session position and keeps composer resizing on the correct scroll owner`、`keyboard paging owns bottom-follow without wheel input`——此处未查明其原因。
- 两个客户端包均重建干净（`tsdown`，116 ms 与 177 ms）。

## 备选方案

**改用真实输入事件（wheel、key、pointer、touch）区分读者输入，而不用偏移账本。** 账本存在的意义正是避免点名设备：它同时覆盖滚动条拖动、键盘翻页、焦点驱动的 `scrollIntoView` 以及浏览器页内查找，而这些都不产生同一种事件。点名设备只会收窄信号而非修好它，何况锚定调整根本不携带任何输入事件，信号仍然需要第二个来源。

**激活后持续贴底直到对话记录稳定（一个权威窗口）。** 激活路径本已在下一帧做一次校正；把它扩展成一个窗口，就要决定窗口何时结束、以及窗口内到来的读者手势如何抢先，而这不过是把同一个归属问题推迟再问。它也没有处理窗口期间发生的锚定调整。

**当记录的 reflow 锚点就是尾部行时，由 `ResizeObserver` 重新贴底。** 这等于从"锚定了哪一行"推断意图：真正停在最后一行的读者从此无法向上滚动而不被拉回；而且在 observer 运行之前，浏览器的调整早已改动了偏移。

**把 `overflow-anchor: none` 设在对话记录的行上，而不是滚动容器上。** 实测可行，但它逐个排除锚点候选子树：每个行元素以及未来每一个行包装元素都必须带上它，只要漏掉一处，该行的旧行为就会悄然回归。

**按滚动位置切换该退出，只在读者远离底部时保留锚定。** 改变该属性会使锚点节点失效，浏览器恰恰会在阅读位置最要紧的时刻重新选取锚点；而这种情况本已由应用自身的重排锚点承担。

## 后果

会话切换现在会落在尾部，并在对话记录完成布局的过程中留在那里；账本的前提——ChatView 未写入的偏移来自读者——对对话滚动容器重新成立。

远离底部时的阅读位置稳定性如今完全依赖 ChatView 的重排锚点。该补偿只在观测到的流列与输入框座位高度变化时运行，因此若某种布局变化移动了阅读行却不改变列高——例如视口上方内容增长、同一帧内别处等量收缩——背后便不再有第二套机制。如果对话记录将来确实需要浏览器锚定，重新引入的条件是获得一个能区分锚定调整与读者手势的跟随归属信号，而不是把 CSS 作用域收窄。

不支持滚动锚定的引擎会忽略该声明，因此这一改动只在存在锚定的地方改变行为。
