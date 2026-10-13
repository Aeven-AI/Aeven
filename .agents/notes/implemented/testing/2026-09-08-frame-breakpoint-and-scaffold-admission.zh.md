# Agent Note: 框架断点读取与 e2e scaffold 准入

Status: implemented

[English](2026-09-08-frame-breakpoint-and-scaffold-admission.md) | 中文

## 问题

两项已交付的改动让本仓库自己的车道在 `main` 上变红，原因都是：行为改了，而依赖该行为的消费方没有跟着改。

`AppFrame` 不再自行测量宽度，改为从 `window.matchMedia` 读取窄视口断点。jsdom 不实现 `matchMedia`，而装配版 web 车道正是在 jsdom 中启动真实的客户端树，于是这次无保护的读取在 `root` slot 内抛错：每个浏览器场景都渲染出 `data-slot-error="root"`，没有应用。该框架自己的单元 spec 在 `beforeEach` 中 stub 了 `matchMedia`，因此单元车道在一棵别处根本挂载不起来的树上保持绿色——stub 掩盖了它本应用来建模的那个缺陷。

同一次改动还移除了侧栏拖拽把手、它的指针处理函数、视口让位链，以及框架用来观察的 `ResizeObserver`。十二个 spec 仍把 `handles[0]` 当作侧栏把手来驱动，仍从已经变成自定义属性的内联 `style.width` 读取详情列宽度，并且仍通过再也不会被赋值的 `fireResize` 驱动 resize——这个调用只是静默地什么都不做，而不是失败。

另一件事是：Aeven 身份行移入了 `avn-web-app` 组合包 patch，因此由它构建的每一种组合都会注册一个 authority。只要注册了一个解析器，`identityUsers.enforcing` 就为真，而一个正在执行的 authority 会取代启动 token：`authenticatedUrl` 返回裸 origin，`authorizeIndex` 对任何人都提供 index。web e2e scaffold 启动的正是那个真实组合，却要求 token 握手——一次带会话 cookie 的、指向 `/` 的 303——于是它的初始化对每个用到它的场景都抛错。

## 决策

框架通过 `matchNarrow()` 读取断点：在运行时不实现 `matchMedia` 时返回 `MediaQueryList` 或 `undefined`。没有该 API 时外壳保持宽版布局，也就是它本来就默认的三列布局。这与客户端树中其他每一个 `matchMedia` 调用方已经采用的保护写法一致——`ui-theme`、`TurnNavigator` 和 `AttachmentRail`——并且让客户端树在没有该 API 的运行时中也能挂载，而不是要求每个 harness 各自 stub 一个。

框架的 spec 描述的是现在存在的这个框架。它的 resize 信号是 `resizeTo()`：移动视口并通知被 stub 的断点监听器，因为媒体查询变化是框架现在唯一能观察到的 resize 信号；`ResizeObserver` stub 与 `fireResize` 句柄被删除，而不是留作什么都不做的调用。详情列是唯一可拖拽的列，因此把手计数与指针序列的 spec 都针对它，并对 `details` 偏好值断言。原先断言视口让位的那些 spec 现在断言它不存在：中间列是 `flex: 1` 加 `min-width: 0`，由 CSS 吸收挤压，因此在断点以上的每一个视口，渲染出的详情列宽度都是被夹取后的偏好值。有一个 spec 直接覆盖缺少 `matchMedia` 的运行时。

web e2e scaffold 在它的 patch 栈中禁用 `identity-user-aeven` 与 `ui-account-aeven`。该 scaffold 不运行任何 Aeven API，而这正是组合包 patch 已经写明的情形：不运行 Aeven API 的部署必须把这两行一起禁用。没有注册解析器时 authority 不执行，启动 token 重新生效，scaffold 现有的握手按原样就是正确的——准入约定并不需要为测试再准备第二种形态。

## 本决策不具备的覆盖

`AppFrame.tsx` 处于 `packages/client/ui-layout/src/*` 覆盖率豁免之下，因此没有任何逐文件门禁观察这些分支；证据是那 60 个 `ui-layout` spec。scaffold 这个决策让 e2e 车道失去了对已交付的已认证路径的覆盖：车道现在演练的是不带 authority 的组合，没有任何无密钥测试端到端覆盖 Aeven 准入。要恢复它，需要一个测试能在没有 Aeven API 的情况下满足的解析器，而这样的解析器目前还不存在。

## 备选方案

**在装配版 web 车道中 stub `matchMedia`，而不是给读取加保护。** 否决，因为这会在每个 harness 中重复本应由树承担一次的事情，也因为它保留了让这个缺陷不可见的那个性质：正是 spec 内的局部 stub，才让一棵别处挂载不起来的树报告绿色。而且加保护本来就是客户端树中其他 `matchMedia` 调用方的做法，无保护的读取才是例外。

**恢复把手以保住侧栏拖拽的那些 spec。** 否决，因为移除把手才是已交付的决策——侧栏宽度是一个由该列在 CSS 中做动画的存储偏好值，为了满足一个 spec 而重新加回指针路径，等于为保住测试而反转该决策。

**不读内容就直接刷新失败的快照与陈旧断言。** 否决，因为其中三处失败是真实的产品变化（面板现在随该列淡入，窄视口内容遮挡层是一个新元素），其余则是崩溃。一次刷新会把崩溃记录成预期输出。

**让 scaffold 通过 authority 完成认证。** 否决，因为车道中不运行任何 Aeven API，也不存在可以顶替它的 stub 解析器。为打通握手而造一个，等于在已交付的准入路径旁边再放一条只供测试使用的准入路径，而这属于围栏自身该声明的约定，不属于 scaffold。

**保持已交付的行启用，并断言那个 200。** 否决，因为 index 背后的 API 路由仍然被围栏挡住：当场景驱动的每一条路由仍然拒绝未认证调用方时，允许访问 index 什么也证明不了。

## 影响

两条车道在干净工作树上都通过：`pnpm run test` 覆盖 1,066 个文件中的 17,888 项断言，web 浏览器车道重新能启动装配后的客户端。客户端树在没有 `matchMedia` 的运行时中也能挂载，因此未来的 harness 无需 stub 即可渲染外壳。

`ui-layout` 的 spec 不再描述列求解器，因为框架已经没有列求解器了。`columns.ts` 中的 `concede()` 仍保留自己的单元 spec，但在框架中已无调用方；详情列是否仍应对窄视口让位，是本 note 未作定论的产品问题，在有结论之前该函数保留。

e2e 车道的组合现在与已交付组合相差两行。这一差异写在造成它的那个 patch 处，因此后来添加依赖准入的场景的读者，能就地找到为什么这里不带 authority 也能准入。
