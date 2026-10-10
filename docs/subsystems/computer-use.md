# Computer use

English | [中文](computer-use.zh.md)

Computer use lets a model observe and operate the local desktop through a configured provider. The shared Aeven capability is called **computer use**; **Cua Driver** names the upstream implementation.

## Choose a provider

Mount [`@aeven/computer-use`](../../packages/computer-use/computer-use/README.md) and one provider in the same composition. The Electron desktop app mounts the Cua Driver MCP provider when a `cua-driver` executable is installed; other compositions activate it explicitly.

| Provider | Runtime |
|---|---|
| [Cua Driver MCP](../../packages/computer-use/computer-use-cua-driver-mcp/README.md) | An already installed `cua-driver` executable connected through MCP |

Each provider supplies its upstream tool catalog. The shared service registers only a name and rejects any second provider, including another instance with the same name. It has no common desktop-operation methods or model-controlled selector.

## Lifetime and desktop sharing

A provider retains its registration while it shuts down its tools and owned resources. Startup failure releases the attempted registration. The MCP provider keeps its registration during reconnects.

One registered provider does not reserve a desktop for a Session. Callers coordinate complete observe, act, and verify workflows across Sessions and separate Aeven processes. A cancelled call cannot undo input that the desktop already received.

## Results and platform requirements

Tools use the normal execution pipeline and Session log. Image-capable model routes with an attachment store receive durable screenshots; unsupported image routes receive the existing MCP image diagnostic. Provider READMEs own installation, permission, and platform limitations.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
<!-- END GENERATED cordis-surface -->
