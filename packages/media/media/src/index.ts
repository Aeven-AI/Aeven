/**
 * Service Definition for the generated-media capability seam (`ctx.media`):
 * image and video provider registries, registration-order-independent
 * selection, and the job vocabulary video providers map onto. Duplicate ids are
 * rejected. Selection resolves at execution time, so a provider mounted later
 * in the same tree cannot change which one an earlier call would have chosen.
 * @module @aeven/media
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  GeneratedMedia,
  MediaImageModel,
  MediaImageProvider,
  MediaImageRequest,
  MediaImageResult,
  MediaVideoJob,
  MediaVideoProvider,
  MediaVideoRequest,
} from './types.ts'
import { MediaError } from './types.ts'

export { imageMediaType } from './bytes.ts'
export { vendorJob, vendorRoute, vendorVideoProvider } from './vendor-route.ts'
export type {
  VendorJobBody, VendorRoute, VendorRouteConfig, VendorVideoRoutes,
} from './vendor-route.ts'
export { MediaError } from './types.ts'
export type {
  GeneratedImage,
  GeneratedMedia,
  MediaImageModel,
  MediaErrorCode,
  MediaImageProvider,
  MediaImageReference,
  MediaImageRequest,
  MediaImageResult,
  MediaProvider,
  MediaVideoJob,
  MediaVideoProvider,
  MediaVideoRequest,
  MediaVideoStatus,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    media: MediaRuntime
  }
}

/**
 * Config for the media seam. Each field pins which provider wins for one kind;
 * both are optional, and a single registered usable provider auto-selects. A
 * request may also name its provider, which outranks both.
 */
export interface MediaRuntimeConfig {
  /** Explicit image provider id. Omitted = auto-select when exactly one usable. */
  readonly imageProvider?: string
  /** Explicit video provider id. Omitted = auto-select when exactly one usable. */
  readonly videoProvider?: string
}

/** Selection inputs resolved per call. */
interface Selection<P> {
  readonly requestedId?: string
  readonly configuredId?: string
  readonly providers: ReadonlyMap<string, P>
}

/**
 * The generated-media service, registered as `ctx.media`.
 *
 * Selection precedence, resolved at execution time: the request's own
 * `provider`, then the configured id, then the single usable provider. Every
 * other case is a {@link MediaError} rather than a silent pick, so adding a
 * second provider never quietly redirects existing calls.
 */
export class MediaRuntime extends Service {
  static Config: z<MediaRuntimeConfig> = z.object({
    imageProvider: z.string(),
    videoProvider: z.string(),
  })

  private imageProviders = new Map<string, MediaImageProvider>()
  private videoProviders = new Map<string, MediaVideoProvider>()
  private readonly imageProviderId: string | undefined
  private readonly videoProviderId: string | undefined

  /**
   * @param ctx - the owning context.
   * @param config - provider pins for this deployment.
   */
  constructor(ctx: Context, config: MediaRuntimeConfig = {}) {
    super(ctx, 'media')
    this.imageProviderId = config.imageProvider
    this.videoProviderId = config.videoProvider
  }

  /**
   * Register an image provider.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters it, disposed with the calling fiber.
   */
  registerImageProvider(provider: MediaImageProvider): () => void {
    return this.registerProvider(this.imageProviders, provider)
  }

  /**
   * Register a video provider.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters it, disposed with the calling fiber.
   */
  registerVideoProvider(provider: MediaVideoProvider): () => void {
    return this.registerProvider(this.videoProviders, provider)
  }

  private registerProvider<P extends { readonly id: string }>(store: Map<string, P>, provider: P): () => void {
    if (store.has(provider.id)) {
      throw new MediaError(
        `a media provider with id "${provider.id}" is already registered`,
        'MEDIA_DUPLICATE_PROVIDER',
      )
    }
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      yield () => store.delete(provider.id)
    }, 'media.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; this API is synchronous
    // fire-and-forget, so discard the always-resolved promise.
    return () => void dispose()
  }

  /**
   * Generate images through the selected provider.
   * @param request - the prompt, model, and generation controls.
   * @param signal - cancellation forwarded to the provider.
   * @returns the generated images and the provider that made them.
   */
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
  async listImageModels(signal?: AbortSignal): Promise<readonly MediaImageModel[]> {
    const listed: MediaImageModel[] = []
    for (const provider of this.imageProviders.values()) {
      if (provider.listImageModels === undefined) continue
      try {
        listed.push(...await provider.listImageModels(signal))
      } catch {
        // An unreachable or unauthorized route contributes no models; the
        // caller's menu keeps every provider that did answer.
      }
    }
    return listed
  }

  /**
   * Generate one image through the selected image provider.
   * @param request - the prompt, model, and generation controls; its `provider` names the route to use instead of the configured default.
   * @param signal - cancellation forwarded to the provider.
   * @returns the generated image.
   */
  async generateImage(request: MediaImageRequest, signal?: AbortSignal): Promise<MediaImageResult> {
    const provider = resolveProvider({
      providers: this.imageProviders,
      ...request.provider !== undefined ? { requestedId: request.provider } : {},
      ...this.imageProviderId !== undefined ? { configuredId: this.imageProviderId } : {},
    })
    return provider.generateImage(request, signal)
  }

  /**
   * Start one video job through the selected provider.
   * @param request - the prompt, model, and generation controls.
   * @param signal - cancellation forwarded to the provider.
   * @returns the accepted job.
   */
  async startVideo(request: MediaVideoRequest, signal?: AbortSignal): Promise<MediaVideoJob> {
    const provider = resolveProvider({
      providers: this.videoProviders,
      ...request.provider !== undefined ? { requestedId: request.provider } : {},
      ...this.videoProviderId !== undefined ? { configuredId: this.videoProviderId } : {},
    })
    return provider.startVideo(request, signal)
  }

  /**
   * Read one video job's state. The job's own provider is named by the job, so
   * polling never re-runs selection and cannot drift to another provider.
   * @param job - the job to poll, as returned by {@link startVideo}.
   * @param signal - cancellation forwarded to the provider.
   * @returns the job's state now.
   */
  async videoStatus(job: MediaVideoJob, signal?: AbortSignal): Promise<MediaVideoJob> {
    return this.videoProviderFor(job).videoStatus(job.id, signal)
  }

  /**
   * Retrieve a succeeded job's bytes.
   * @param job - the succeeded job.
   * @param signal - cancellation forwarded to the provider.
   * @returns the finished clip.
   */
  async fetchVideo(job: MediaVideoJob, signal?: AbortSignal): Promise<GeneratedMedia> {
    return this.videoProviderFor(job).fetchVideo(job.id, signal)
  }

  /** The provider that owns one job, or the missing-provider failure. */
  private videoProviderFor(job: MediaVideoJob): MediaVideoProvider {
    const provider = this.videoProviders.get(job.provider)
    if (provider === undefined) {
      throw new MediaError(
        `media video provider "${job.provider}" is not registered`,
        'MEDIA_PROVIDER_CONFIGURED_MISSING',
      )
    }
    return provider
  }
}

/** Resolve the selected provider or throw the matching {@link MediaError}. */
function resolveProvider<P extends { readonly id: string; available(): boolean }>(selection: Selection<P>): P {
  const { requestedId, configuredId, providers } = selection
  const pinned = requestedId ?? configuredId
  if (pinned !== undefined) {
    const provider = providers.get(pinned)
    if (provider === undefined) {
      throw new MediaError(`media provider "${pinned}" is not registered`, 'MEDIA_PROVIDER_CONFIGURED_MISSING')
    }
    if (!provider.available()) {
      throw new MediaError(
        `media provider "${pinned}" is registered but not usable`,
        'MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE',
      )
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const only = usable[0]
  if (only === undefined) {
    throw new MediaError('no usable media provider is registered', 'MEDIA_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    throw new MediaError(
      `several usable media providers are registered (${usable.map(p => p.id).join(', ')}); name one in the request or pin one in config`,
      'MEDIA_PROVIDER_AMBIGUOUS',
    )
  }
  return only
}

export default MediaRuntime
