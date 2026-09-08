# Agent Note: 登录流程之外的 eager 渲染家族加载

Status: implemented

[English](2026-09-07-eager-render-family-loading.md) | 中文

## 问题

Web 外壳会静态触达 UI primitives、KaTeX、highlight.js 与 mdast 流水线。在慢速连接下，这些 payload 占据外壳依赖图并推迟认证，即使登录界面并不渲染 markdown。应用批次的 preload 提示也以默认优先级竞争，而认证要到后续动态导入时才会被发现。

把 UI primitives 移到 eager 动态导入后还产生了一项要求：`ClientModuleSystem` 在构造时会把 `staticModules` 快照到自身 seed map。构造完成后再把 UI primitives 加入调用方对象，不会让已登录插件工厂得到该平台模块，并会造成运行时 `require()` miss。

## 决策

认证代码和样式是显式的初始外壳分片。外壳在 module 求值时启动 UI-primitives 动态导入，立即发现其 KaTeX、highlight.js 与 mdast 依赖，但认证 gate 不等待该请求。应用字体也会立即开始加载；只有完整应用挂载会等待字体。

认证成功的启动会等待 UI primitives，并在调用 `window.__ModuleLoader__.create()` 前把已解析模块加入 `staticModules`。插件预取只在完整模块表被快照后开始。未认证的启动挂载登录界面后返回，而渲染家族请求继续并行进行。

Rollup 采用 `onlyExplicitManualChunks`，并显式分配 `auth`、`react`、`primitives`、`katex`、`hljs` 与 `mdast`。这样既保留具名缓存家族，也不会把手工命名异步分片的依赖闭包拉回外壳执行路径。Host 应用批次提示仍会 eager 加载，位于外壳自身 head 资源之后，并使用低 fetch priority，避免这些请求推迟认证资源。

## 验证

客户端启动测试要求模块系统构造时 `staticModules` 已含 UI primitives，再通过真实客户端模块系统求值应用批次。构建产物测试要求入口含 primitives 动态导入、`dist/assets` 含具名渲染家族分片，并要求 HTML 不为 primitives、KaTeX、highlight.js 或 mdast 生成 modulepreload。注入测试要求应用 preload 位于外壳 module 之后且使用低 fetch priority。已认证浏览器重新加载后必须进入应用，且不得出现 loader-entry 或 module-table 失败。

## 考虑过的替代方案

**在认证前构造模块系统，之后修改输入表。** 模块系统拥有快照 map，因此后续修改无法更新插件的 `require()` 解析。

**在认证前等待渲染家族。** 这会恢复拆分所消除的慢速连接延迟。

**移除应用插件 preload。** 认证后会立即需要这些插件。低优先级 eager 提示既保留提前传输，也不让这些大型请求排在登录资源之前。

## 后果

登录界面会在外壳、React、认证分片与会话请求就绪后立即渲染。渲染库与应用 bundle 及时开始加载，但不会阻塞该界面。已登录启动仍会在任何插件工厂执行前等待完整平台 seed，从而保持同步共享模块标识。
