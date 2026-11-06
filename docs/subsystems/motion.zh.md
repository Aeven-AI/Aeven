# 动态影片

[English](motion.md) | 中文

服务声明：[源码](../../packages/motion/motion/src/index.ts)。包契约：[motion/](../../packages/motion/README.zh.md)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmotion--motion"></a>

### `ctx.motion` — `Motion`

Holds the sole motion renderer of one Host composition.

```ts cordis-catalog
/**
 * Register the composition's renderer; a second registration fails without replacing the first.
 * @param renderer - renderer owned by the contributing fiber.
 * @returns idempotent disposer which aborts accepted renders and joins their settlement.
 */
register(renderer: MotionRenderer): () => Promise<void>

/**
 * Apply the configured defaults and capture the registered renderer.
 * @param request - composition, output, and optional fps, quality, and still count.
 * @returns renderer-pinned input for {@link render}.
 * @throws When no renderer is registered.
 */
resolve(request: MotionRenderRequest): MotionRenderSpec

/**
 * Bundle a composition folder with the registered renderer.
 * @param compositionDir - absolute folder holding `index.html`.
 * @returns the self-contained HTML document described at {@link MotionRenderer.bundle}.
 * @throws When no renderer is registered.
 */
async bundle(compositionDir: string): Promise<string>

/**
 * Render with exactly the resolved renderer.
 * @param spec - resolved render; a withdrawn or replaced renderer is rejected.
 * @param signal - caller cancellation.
 * @param onProgress - optional progress sink.
 * @returns the written film.
 */
async render(spec: MotionRenderSpec, signal: AbortSignal, onProgress?: (progress: MotionProgress) => void): Promise<MotionRenderOutput>
```

Source: [`packages/motion/motion/src/index.ts`](../../packages/motion/motion/src/index.ts)
<!-- END GENERATED cordis-surface -->
