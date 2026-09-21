# Agent Note: 会话结束时把页面交还给 gate

Status: implemented

[English](2026-09-22-session-end-hands-the-page-back.md) | 中文

## Problem

启动 gate 会等待读者完成并在原位启动（[gate 的那次改动](2026-09-21-auth-gate-boots-in-place.zh.md)），因此登录、命名以及 provider 返回都不再需要文档加载。**启动之后**才结束的会话是例外：`leaveForSignIn()` 删除持有的 bearer、把路径记入 `authReferrer`，然后调用 `window.location.assign(AUTH_ROUTES.signIn)`。

那次加载是最后一个既非 provider、也非部署所选择的加载，而它的代价是读者失去自己所在的页面：一次被 API 拒绝续期的 RPC，或另一个标签页的登出，为了抵达一个 kernel 本来就懂得如何呈现的界面，替换掉了整个外壳。

## Decision

**会话的结束是"上报"，不是"执行"。** `watch.ts` 持有一组监听者并导出 `onSessionEnded(listener)`，返回 disposer。`leaveForSignIn()` 丢弃持有的 bearer、重置会话、通知每个监听者。它不再触碰地址：地址由拥有页面的一方移动，而 gate 在移动时把读者自己的路径记为 referrer——这正是它面向"从未登录的读者"的无认证分支本来就在做的两件事。

**交还由 boot kernel 负责。** `AppWebEntry.run()` 只订阅一次，运行一遍 pass，然后以脱离的方式跟随该文档的会话：

- `run()` 仍在该次调用**自己启动的那一遍**结束时 resolve，这是外壳与所有 boot spec 已经依赖的约定。把循环 await 在 `run()` 里，会让应用一起来就挂住每一个调用方。
- 每一遍 pass 打开一个 latch。gate 挂载的界面以 `Promise.race([screen.authenticated, latch.promise])` 等待，因此**界面还在时**会话结束也会停止该界面的等待：循环重新读取会话、发现没有，于是挂载登录界面。
- latch 触发后 `leavePage()` 释放插件树。每个 effect 的 disposer 都会运行，这正是把已挂载的 renderer 从容器上摘下的机制，下一遍 pass 随即在一个空闲容器上开始。boot 页面保留自己的 dispose，而 gate 已经在每个界面之前执行过它。
- 失败的一遍会清掉自己的 latch，因此跟随随之结束：失败留在页面上，其上再没有可呈现的东西。

**第二次安装会替换它的 watcher。** `installAuthenticatedTransport()` 会被 gate 在每一遍已认证的 pass 里调用，而每次调用都会启动一个续期 watcher。现在它会先停掉上一次安装启动的那个，因此会话结束之后再次 boot 的页面只运行一个续期定时器，而不是每个会话一个。

**`watchSession()` 就是"本页没有在离开"的那个事实。** `leaving` 曾用来把守续期循环；现在它由 `watchSession()` 自身重置，因为"正在观察会话"这件事本身就说明读者持有会话。缺了这次重置，会话结束后重新登录的读者将永远不会被续期——新的 watcher 会在第一次检查时直接返回。

## Alternatives considered

**保留该加载并把它做得更便宜。** 已否决，理由与启动 gate 相同：重新加载正是不透明重绘遮罩的成因，而 kernel 完全能在读者已经身处的文档里呈现登录界面。

**让 `leaveForSignIn()` 继续导航，kernel 只处理应用正在运行的情形。** 已否决：服务内部的 `navigateRoute` 会在界面或插件树仍占有容器时移动地址，而 kernel 随后还得察觉一次并非它自己发起的导航。一个所有者，一种机制。

**通过浏览器事件上报（`window.dispatchEvent`）。** 已否决：页面级事件对页面上的一切可达，包括插件，而消费者只有 kernel 一个。带 disposer 的模块 seam 让订阅者列表及其生命周期都是显式的。

**从包的 `/client` 入口导出 `leaveForSignIn`，以便测试触发它。** 已否决：boot spec 直接通过包的 `./src/*` 子路径导入该模块，那些测试正是为此存在的。为一个测试而拓宽入口，是客户端包明文禁止的做法。

## Consequences

被拒的过期会话 RPC，以及另一个标签页的登出，现在都在读者身处的这份文档里把他们带回登录界面，再次登录即从原处继续。会话能走的任何路径上都不再剩下文档加载。

代价是 kernel 要跨多遍 pass 持有页面的会话状态：一遍结束后，它的 `Context` 已被 dispose、容器已空、latch 已用尽，下一遍会把这三者重建。把进程级状态放在自身 fiber 之外保留的插件会存活于那次拆解之外；仓库的注册规则本就要求每一项贡献都成为 effect，这正是它安全的原因。

`packages/client/web/src/*` 与 `.../auth/mount.tsx` 仍在逐文件覆盖率门禁之外；本决策的保障是行为：`boot.client.spec.ts` 启动应用、结束会话，并断言插件树被 dispose、登录界面挂载在同一个容器里、地址经 `pushState` 变更、读者的路径被记为 referrer。它在改动前的源码上会失败。

## Testing

- `boot.client.spec.ts` —— 上述交还，经由与 kernel 订阅同一模块实例的 `leaveForSignIn()` 触发。
- `watch.client.spec.ts` —— 续期被拒与跨标签页登出各自只上报一次结束、丢弃持有的 bearer，并把地址与 referrer 留给页面所有者。
- `name-check.client.spec.tsx` —— 被拒的名字上报结束而非导航，因此离开命名步骤的是 kernel，而不是该界面。
- `config.client.spec.ts` —— 无法解析的 provider URL 原样透传，这正是 provider 路径自身 catch 所声明的。
