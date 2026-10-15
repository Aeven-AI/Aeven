# 计算机操作

[English](computer-use.md) | 中文

计算机操作让模型通过配置的提供方观察并操作本地桌面。Aeven 的共享能力称为 **computer use（计算机操作）**；**Cua Driver** 是上游实现的名称。

## 选择提供方

在同一组合中挂载 [`@aeven/computer-use`](../../packages/computer-use/computer-use/README.zh.md) 和一个提供方。Web 应用和 Electron 桌面应用在 macOS 与 Windows 上、已安装 `cua-driver` 可执行程序时挂载 Cua Driver MCP 提供方；其他组合需显式启用。macOS 与 Windows 各自还提供一个自行驱动桌面的第一方批量提供方，它不占用注册位。

| 提供方 | 运行时 |
|---|---|
| [Cua Driver MCP](../../packages/computer-use/computer-use-cua-driver-mcp/README.zh.md) | 通过 MCP 连接已安装的 `cua-driver` 可执行文件 |
| [macOS 语义批次](../../packages/computer-use/computer-use-macos-provider/README.zh.md) | 在一行中装配 macOS 适配器、路由器、执行器与 Apple Events 处理器 |
| [Windows 语义批次](../../packages/computer-use/computer-use-windows-provider/README.zh.md) | 在一行中装配 Windows 适配器、路由器、执行器与 COM 处理器 |

各提供方提供上游工具目录。共享服务只注册名称，并拒绝任何第二个提供方，包括使用相同名称的另一个实例。服务不包含通用桌面操作方法或模型控制的选择器。

macOS Web 和 Electron 组合还通过 `register: false` 挂载[语义批次](../../packages/computer-use/computer-use-macos-provider/README.zh.md)，Windows 则挂载 [Windows 提供方](../../packages/computer-use/computer-use-windows-provider/README.zh.md)。`computer_use_run` 暴露 `ComputerUseSession.run()` 和逐期望校验，Cua Driver 保留注册和交互工具。批量调用不实现无障碍或视觉降级。

## 生命周期和桌面共享

提供方在关闭工具和自有资源期间保留注册。启动失败会释放此次尝试的注册。MCP 提供方在重连期间保留注册。

一个已注册的提供方不会为某个 Session 预留桌面。调用方负责协调跨 Session 和独立 Aeven 进程的完整观察、操作和验证流程。取消调用无法撤销桌面已收到的输入。

## 结果和平台要求

工具使用常规执行流程和 Session 日志。支持图像的模型路由在挂载附件存储时接收持久化截图；不支持图像的路由接收现有 MCP 图像诊断。提供方 README 负责说明安装、权限和平台限制。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcomputeruse--computeruseregistry"></a>

### `ctx.computerUse` — `ComputerUseRegistry`

Owns one optional provider registration in the shared computer-use service.

```ts cordis-catalog
/**
 * Reserve the sole provider slot until the contribution is disposed.
 * A second registration fails even when it repeats the current name. Providers
 * must stop their tools and await owned work before releasing this registration.
 * @param name - provider-owned name used in registration diagnostics.
 * @returns the effect disposer for this exact registration.
 */
register(name: ComputerUseProviderName): () => Promise<void>
```

Source: [`packages/computer-use/computer-use/src/index.ts`](../../packages/computer-use/computer-use/src/index.ts)

<a id="ctxcomputeruseprovider--maccomputeruseprovider"></a>

### `ctx.computerUseProvider` — `MacComputerUseProvider`

The macOS computer-use provider.

Exposes the pieces a consumer needs rather than hiding them behind one method, because the useful questions differ: a settings surface wants `readiness()`, a router wants `routing`, and a tool wants `session`.

```ts cordis-catalog
/**
 * The host's readiness: which grants are held, by which identity, and by what.
 * @returns the readiness report for this adapter.
 */
readiness(): Promise<ReadinessReport>

/**
 * Perform one task and establish whether it worked.
 * @param request - the task, its application, and its parameters.
 * @returns the outcome, with per-expectation results.
 */
execute(request: Parameters<TaskExecutor['execute']>[0]): Promise<ExecutionOutcome>

/**
 * Resolve a task without running it, for a caller that wants to show the plan.
 * @param request - the task, platform, application and available rungs.
 * @returns the resolved recipe.
 */
resolve(request: Parameters<TaskExecutor['routing']['resolve']>[0]): ResolvedRecipe

/**
 * The recipe book this provider serves, so a caller can list what is available.
 * @returns the task names.
 */
tasks(): string[]
```

Source: [`packages/computer-use/computer-use-macos-provider/src/index.ts`](../../packages/computer-use/computer-use-macos-provider/src/index.ts)

<a id="ctxwindowscomputeruseprovider--windowscomputeruseprovider"></a>

### `ctx.windowsComputerUseProvider` — `WindowsComputerUseProvider`

The Windows computer-use provider.

Exposes the pieces a consumer needs rather than hiding them behind one method, because the useful questions differ: a settings surface wants `readiness()`, a router wants `routing`, and a tool wants `session`.

```ts cordis-catalog
/**
 * The host's readiness: which capabilities are present, and which are missing.
 * @returns the readiness report for this adapter.
 */
readiness(): Promise<ReadinessReport>

/**
 * Perform one task and establish whether it worked.
 * @param request - the task, its application, and its parameters.
 * @returns the outcome, with per-expectation results.
 */
execute(request: Parameters<TaskExecutor['execute']>[0]): Promise<ExecutionOutcome>

/**
 * Resolve a task without running it, for a caller that wants to show the plan.
 * @param request - the task, platform, application and available rungs.
 * @returns the resolved recipe.
 */
resolve(request: Parameters<TaskExecutor['routing']['resolve']>[0]): ResolvedRecipe

/**
 * The recipe book this provider serves, so a caller can list what is available.
 * @returns the task names.
 */
tasks(): string[]
```

Source: [`packages/computer-use/computer-use-windows-provider/src/index.ts`](../../packages/computer-use/computer-use-windows-provider/src/index.ts)

<a id="location-events"></a>

### `location/*` events

<a id="locationrequest--waterfall"></a>

#### `location/request` — waterfall

Ask the reader of a session for their location. The client showing that session asks the reader and returns their choice; a listener that cannot ask calls `next()` to delegate. Scope-filtered dispatch (`@aeven/scope`): agent-scoped listeners receive only that agent.

```ts cordis-catalog
/**
 * Ask the reader of a session for their location. The client showing that
 * session asks the reader and returns their choice; a listener that cannot
 * ask calls `next()` to delegate. Scope-filtered dispatch (`@aeven/scope`):
 * agent-scoped listeners receive only that agent.
 * @param request - pending location request.
 * @mode waterfall
 */
'location/request'( this: Scoped<Agent>, request: LocationRequestEvent, next: () => Promise<LocationAnswer>, ): Promise<LocationAnswer>
```

Types: [Agent](core.zh.md) · [Scoped](scope.zh.md)

Source: [`packages/interaction/tool-location/src/types.ts`](../../packages/interaction/tool-location/src/types.ts)
<!-- END GENERATED cordis-surface -->
