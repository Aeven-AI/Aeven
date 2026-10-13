# Agent Note: MemOS Viewer 默认关闭

Status: implemented

[English](2026-10-01-memos-viewer-default-off.md) | 中文

## Problem

只要 `viewer` 为真，`@aeven/memory-memos` 就会提供 MemOS Viewer——一个对**每一位**所有者的记忆做读写的 HTTP 界面，无需登录——而 `viewer` 默认是 `true`。已发布的 `avn-web-app` bundle 早已选择关闭（`viewer: false`，并附了原因注释），因此没有任何已发布组合暴露它。但这个默认值仍然重要：任何其他组合，只要挂载该提供者却没有写 `viewer`——用户自己的 profile patch、将来的某个 bundle、获得记忆行之后的桌面打包——都会启动一个覆盖所有账户的未认证界面，而配置里没有任何东西说明这一点。

`viewerHost` 本就拒绝非回环地址，所以暴露仅限本机。本机并不等于安全：机器上的任何进程，以及任何能访问 `127.0.0.1` 的页面，都可以通过它读写整个记忆库。

## Decision

`viewer` 默认改为 `false`：组合需要主动选用 Viewer，而不是继承它。`avn-web-app` 保留其显式的 `viewer: false`，因此没有任何已发布 profile 的行为发生变化。启动行改为警告——``viewer live at <url> — it serves every owner's memory without sign-in``——于是真正开启它的运维者会在日志里看到正在作答的到底是什么，而不是一条读起来与其他就绪信息无异的 info 行。

`packages/memory/memory-memos/tests/viewer-default.spec.ts` 固定三件事：默认关闭、显式 `true` 仍会启动它、除非组合另行指定，绑定地址保持回环。

## Alternatives considered

- **保留默认开启，依赖各组合自行关闭。** 正是这种安排让已发布 bundle 必须携带一条安全注释；一个必须在每个未来组合里被记住的默认值，就是一个会被忘记的默认值。
- **移除 Viewer。** 它是上游引擎自带的检视界面，也是不经过宿主直接读取已存记忆的唯一方式；移除它会让一项受支持的引擎特性变得不可达，而不是让它成为可选。
- **保持启动行为 info 级别。** 配置错误应当可见；开启一个无登录界面，正是警告应当出现的情形。
- **给 Viewer 加令牌。** 它是上游的界面，其路由不属于我们去做认证；选择启用才是诚实的边界。

## Consequences

想要 Viewer 的部署现在必须写 `viewer: true`，并且在其运行期间日志会说明它暴露了什么。已发布内容没有任何变化：唯一挂载该提供者的组合本就已经关闭它。

剩余暴露是该引擎特性固有的：一旦开启，它不凭身份作答，这就是它默认关闭、且开启时会被警告的原因。

## Verification

`pnpm exec vitest run packages/memory/memory-memos` 在 2 个文件中通过 9 个测试，其中包括三个新增的默认值与绑定用例；`npx tsc -b packages/memory/memory-memos` 无错误。在运行中的宿主上，`lsof -nP -iTCP:18801 -sTCP:LISTEN` 没有监听者，且唯一挂载该提供者的组合（`packages/bundle/web-app/cordis.patch.yml`）设置了 `viewer: false`。
