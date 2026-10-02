# 生成式媒体

[English](media.md) | 中文

生成式媒体 seam——一个横跨**两种媒介**（图片与视频）、位于单个 `ctx.media` 服务上的[能力 seam](../../.agents/notes/implemented/architecture/2026-09-03-generated-media-capability-seam.zh.md)：Service Definition（[avn-media](../../packages/media/media)，`ctx.media` 与各 provider 注册表）、Service Provider，以及拥有模型所见一切的 Consumer。生成式媒体是**一项可选能力**，不属于 agent-loop 主干——因此它的词汇位于此处，而非 [core.md](core.zh.md)。更换 provider 不会改变调用方索取图片或片段的方式。

来源：[`packages/media/media/src/types.ts`](../../packages/media/media/src/types.ts)

## 为什么一项能力覆盖两种媒介

图片与视频不共享请求 schema——只有视频是任务——但它们被刻意置于单个 `ctx.media` 中间层：一套 provider 标识、一份凭据、一套选择策略、一套取消与错误词汇。所调研的两家 provider 都用同一个账号与同一个 base URL 提供图片与视频，因此拆分 seam 只会把这一切复制一遍来描述同一家厂商两次。代价是服务上并列的图片与视频方法组；这种并列是有意的。

provider 注册的是**能力**（`MediaImageProvider` 或 `MediaVideoProvider`），而非工具。面向模型的名称、schema、提示词指引与呈现都属于消费方。

## 图片

`generateImage()` 接受提示词、provider 自己的模型 id（原样传递），以及可选的生成控制项——数量、宽高比、分辨率、精确尺寸、种子、背景，以及用于图生图的参考图。它返回 `GeneratedMedia`：一个 IANA 媒体类型与完整字节。seam 从不改写模型 id，因此 provider 的目录始终是"什么有效"的权威。

## 视频是任务

所调研的每家 provider 都把视频当作异步工作，seam 也如此。`startVideo()` 返回一个 `MediaVideoJob`；调用方轮询 `videoStatus()` 直到任务报告 `succeeded`，再调用 `fetchVideo()` 取回字节。seam 自身不运行任何轮询循环——调用方拥有自己的节奏，因此工具可以呈现进度而不是阻塞在服务内部。

`MediaVideoStatus` 为 `running | succeeded | failed`。它描述调用方接下来能做什么，而不是上游选择了什么称呼。该词汇沿用唯一枚举了自身状态的那家 provider；其余的映射到它。这种映射是承重的：某家 provider 对正在渲染的任务报告排队状态，且根本不发布任何运行中状态，其排队状态被映射为 `running`。把该状态读作"尚未开始"将误报每一个任务。

## 取回字节

`fetchVideo` 通过 provider 自身的内容路由取回，绝不使用任务体携带的任何 URL。中介方的任务体指向的是实际服务该模型的上游，因此针对这些主机的出口白名单是无界且无法固定的。通过 provider 取回可把出口保持在部署已经信任的主机上，这也是取回作为 seam 方法、而非由调用方自行完成的原因。

## provider 选择

选择按调用解析，顺序唯一：请求自带的 `provider`，然后是配置的 `imageProvider` / `videoProvider`，最后是唯一可用的 provider。其余情况都是带错误码的失败而非静默挑选，因此挂载第二个 provider 不会悄悄改变已经能用的调用。轮询与获取按任务中记录的 provider 路由，绝不重新执行选择，因此任务不会在轮询与获取之间漂移到另一个后端。

## 错误

每个失败都是携带 `MediaErrorCode` 的 `MediaError`。选择类失败区分被指定但不存在的 provider（`MEDIA_PROVIDER_CONFIGURED_MISSING`）与存在但不可用的 provider（`MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE`），也区分空注册表（`MEDIA_PROVIDER_UNAVAILABLE`）与有歧义的注册表（`MEDIA_PROVIDER_AMBIGUOUS`），因此调用方能分辨配置错误与缺失凭据。provider 以 `MEDIA_INVALID_REQUEST` 拒绝自己无法满足的请求，并以 `MEDIA_UPSTREAM` 报告上游失败。

## 服务

`MediaRuntime` 注册图片与视频 provider，按种类以 `MEDIA_DUPLICATE_PROVIDER` 拒绝重复 id，并在执行时以结构化的选择错误解析 provider。它不做任何存储：持久化、保留期与任何可寻址路由属于决定产物存活多久的消费方。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmedia--mediaruntime"></a>

### `ctx.media` — `MediaRuntime`

The generated-media service, registered as `ctx.media`.

Selection precedence, resolved at execution time: the request's own `provider`, then the configured id, then the single usable provider. Every other case is a MediaError rather than a silent pick, so adding a second provider never quietly redirects existing calls.

```ts cordis-catalog
/**
 * Register an image provider.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters it, disposed with the calling fiber.
 */
registerImageProvider(provider: MediaImageProvider): () => void

/**
 * Register a video provider.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters it, disposed with the calling fiber.
 */
registerVideoProvider(provider: MediaVideoProvider): () => void

/**
 * Every image model the registered providers serve, in registration order.
 *
 * A provider that publishes no catalog contributes nothing, and one whose
 * catalog call fails is skipped rather than failing the whole listing: a
 * menu built from three providers is more useful than an error because one
 * route was unreachable.
 * @param signal - cancellation forwarded to every provider.
 * @returns the models, grouped by provider in registration order.
 */
async listImageModels(signal?: AbortSignal): Promise<readonly MediaImageModel[]>

/**
 * Generate one image through the selected image provider.
 * @param request - the prompt, model, and generation controls; its `provider` names the route to use instead of the configured default.
 * @param signal - cancellation forwarded to the provider.
 * @returns the generated image.
 */
async generateImage(request: MediaImageRequest, signal?: AbortSignal): Promise<MediaImageResult>

/**
 * Start one video job through the selected provider.
 * @param request - the prompt, model, and generation controls.
 * @param signal - cancellation forwarded to the provider.
 * @returns the accepted job.
 */
async startVideo(request: MediaVideoRequest, signal?: AbortSignal): Promise<MediaVideoJob>

/**
 * Read one video job's state. The job's own provider is named by the job, so
 * polling never re-runs selection and cannot drift to another provider.
 * @param job - the job to poll, as returned by {@link startVideo}.
 * @param signal - cancellation forwarded to the provider.
 * @returns the job's state now.
 */
async videoStatus(job: MediaVideoJob, signal?: AbortSignal): Promise<MediaVideoJob>

/**
 * Retrieve a succeeded job's bytes.
 * @param job - the succeeded job.
 * @param signal - cancellation forwarded to the provider.
 * @returns the finished clip.
 */
async fetchVideo(job: MediaVideoJob, signal?: AbortSignal): Promise<GeneratedMedia>
```

Source: [`packages/media/media/src/index.ts`](../../packages/media/media/src/index.ts)
<!-- END GENERATED cordis-surface -->
