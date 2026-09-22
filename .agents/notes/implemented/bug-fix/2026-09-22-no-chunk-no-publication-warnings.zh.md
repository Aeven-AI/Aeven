# Agent Note: 不再产出共享 chunk，也不再输出发布告警

Status: implemented

[English](2026-09-22-no-chunk-no-publication-warnings.md) | 中文

## Problem

`publint` 与 `verify-built-package-invariants` 为红，且 `publint` 还会为每个包打印一条告警。

三十九个 invariant 伴生包中，只有 `packages/workspace/workspace` 的入口与伴生入口共享运行时代码：两者都要用到 `kindPathAgrees` 与 `WorkspaceId` 转换，因而都会拉入入口用来构建 domain schema 的 schema 模块。两个入口一起打包时，构建把该模块拆成了 `lib/src-<hash>.js`，于是 `lib/index.js` 与 `lib/invariant.js` 都带着一个 `files` 未发布的文件的 import：

```
packages/workspace/workspace/lib/index.js:1 imports "./src-i6LT6W5D.js", but @aeven/workspace does not publish "lib/src-i6LT6W5D.js"
verify-built-package-invariants: Cannot find module '.../.aeven-built-invariant-*/lib/src-i6LT6W5D.js'
```

另一件事：每个包都会报 `pkg.exports["./src/*"] is ./src/* but does not match any files.`，一次运行 268 行。该判定并不致命，但它会为每个包打印，因此一次运行的输出里在任何真实信息之前就带着每包一行的噪音。

## Decision

`packages/workspace/workspace/tsdown.config.ts` 把入口与其伴生包构建为两个彼此独立的 bundle，这正是 `packages/core/scope` 与 `packages/core/agent-loop` 已采用的形态。构建期两者不共享任何模块，于是不会有东西被拆出去，发布负载也保持 `files` 指定的两个入口文件。被重复的内联代码是一个纯谓词与一个纯转换，因此每份副本都不携带必须保持同一的身份。

`scripts/publint-all.ts` 精确地丢弃 `./src/*` 这一个导出键上的这一条判定，与它此前丢弃浏览器产物的 CJS interop 判定同法。其它任何匹配不到文件的 glob 导出、以及 `./src/*` 上的其它判定，照旧上报。

## Alternatives considered

把 chunk 纳入发布负载符合负载本身（`lib/types/**/*.js` 本就发布），但与 `files` 和 `constraints` 门禁冲突——两者都把发布面固定为那两个入口文件；改动它们属于仓库级策略决定，而这个 chunk 只为一个包存在。在伴生包内复制 `kindPathAgrees` 与 id 转换被否决，因为那样 invariant 检查的规则将不再与它观测的代码同源。从 268 个 manifest 中删除 `./src/*` 并重写包外测试的 import 被否决，因为该子路径正是"包外 spec 访问内部实现"的既定方式。

## Consequences

- `pnpm run publint`、`pnpm run verify-built-package-invariants`、`pnpm run constraints` 均以 0 退出，且 publint 的输出不再带每包一行的告警。
- `packages/workspace/workspace/lib/` 中恰好只有 `index.js`、`invariant.js` 与 `lib/types`；`pnpm run check:all` 目前没有失败门禁。
- 该门禁的 spec 固定了过滤器的两侧：`./src/*` 的判定不出现在输出中，而另一个匹配不到文件的 glob 导出仍会被上报。
