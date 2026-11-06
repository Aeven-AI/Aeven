/**
 * Motion rendering: the `ctx.motion` Service Definition that turns an authored HTML animation
 * composition into an MP4 film. A Host composition registers exactly one renderer; consumers resolve a
 * request into a spec, then render that spec.
 * @module @aeven/motion
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Motion composition renderer. */
    motion: Motion
  }
}

/** Frame rates a motion film is rendered at. */
export type MotionFps = 24 | 30 | 60

/** Encoding quality tiers, from fastest and smallest to slowest and sharpest. */
export type MotionQuality = 'draft' | 'standard' | 'high'

/** A caller's render request; omitted fields take the service's configured defaults in {@link Motion.resolve}. */
export interface MotionRenderRequest {
  /** Absolute local directory holding the composition's `index.html`. */
  readonly compositionDir: string
  /** Absolute local path the MP4 is written to; its directory is created when missing. */
  readonly outputPath: string
  readonly fps?: MotionFps
  readonly quality?: MotionQuality
  /** Evenly spaced stills to return with the film; omitted, none. */
  readonly stills?: number
}

/** A fully resolved render: every field the renderer reads is present. */
export interface MotionRenderInput {
  readonly compositionDir: string
  readonly outputPath: string
  readonly fps: MotionFps
  readonly quality: MotionQuality
  readonly stills: number
}

/** One PNG frame taken from the finished film. */
export interface MotionStill {
  /** Film time the frame shows. */
  readonly seconds: number
  readonly png: Uint8Array
}

/** One progress observation; `fraction` runs from 0 to 1. */
export interface MotionProgress {
  readonly fraction: number
  /** Renderer-named stage, such as capture or encode. */
  readonly stage?: string
}

/** The finished film. */
export interface MotionRenderOutput {
  /** Absolute path of the written MP4. */
  readonly outputPath: string
  readonly bytes: number
  readonly durationSeconds: number
  readonly width: number
  readonly height: number
  /** The ffmpeg video encoder that produced the H.264 stream, such as `h264_videotoolbox`. */
  readonly encoder: string
  /** The requested stills, in film order. */
  readonly stills: readonly MotionStill[]
}

/** A renderer a provider registers into {@link Motion}. */
export interface MotionRenderer {
  /** Display name, such as `HyperFrames`. */
  readonly name: string
  /**
   * Render one composition to an H.264 MP4.
   * @param input - resolved render.
   * @param signal - cancellation; the renderer removes a partial output when it aborts.
   * @param onProgress - optional progress sink.
   * @returns the written film.
   */
  render(input: MotionRenderInput, signal: AbortSignal, onProgress?: (progress: MotionProgress) => void): Promise<MotionRenderOutput>
  /**
   * Bundle one composition folder into a single HTML document that plays without its folder: scene files,
   * the player runtime, images, and fonts are inlined, so a player can load it as `srcdoc` in an opaque-origin
   * frame that resolves no relative URL.
   * @param compositionDir - absolute folder holding `index.html`.
   * @returns the document's HTML.
   */
  bundle(compositionDir: string): Promise<string>
}

/** {@link Motion.resolve} output: the renderer it captured plus the resolved input. */
export interface MotionRenderSpec extends MotionRenderInput {
  readonly renderer: MotionRenderer
}

/** Composition defaults for requests that omit a field. */
export interface Config {
  /** Frame rate of a request that names none. */
  fps: MotionFps
  /** Quality tier of a request that names none. */
  quality: MotionQuality
}

interface Registration {
  readonly renderer: MotionRenderer
  readonly lifetime: AbortController
  readonly pending: Set<Promise<unknown>>
}

/** Holds the sole motion renderer of one Host composition. */
export default class Motion extends Service {
  static Config: z<Partial<Config>, Config> = z.object({
    fps: z.union([24, 30, 60] as const).default(30),
    quality: z.union(['draft', 'standard', 'high'] as const).default('standard'),
  })

  private registration: Registration | undefined

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'motion')
    ctx.effect(() => async () => {
      if (this.registration !== undefined) await this.remove(this.registration)
    })
  }

  /**
   * Register the composition's renderer; a second registration fails without replacing the first.
   * @param renderer - renderer owned by the contributing fiber.
   * @returns idempotent disposer which aborts accepted renders and joins their settlement.
   */
  register(renderer: MotionRenderer): () => Promise<void> {
    if (this.registration !== undefined) throw new Error(`Motion renderer already registered: ${this.registration.renderer.name}`)
    const registration: Registration = { renderer, lifetime: new AbortController(), pending: new Set() }
    this.registration = registration
    return async () => { await this.remove(registration) }
  }

  private async remove(registration: Registration): Promise<void> {
    if (this.registration !== registration) return
    this.registration = undefined
    registration.lifetime.abort(new Error('Motion renderer unloaded'))
    await Promise.allSettled(registration.pending)
  }

  /**
   * Apply the configured defaults and capture the registered renderer.
   * @param request - composition, output, and optional fps, quality, and still count.
   * @returns renderer-pinned input for {@link render}.
   * @throws When no renderer is registered.
   */
  resolve(request: MotionRenderRequest): MotionRenderSpec {
    const registration = this.registration
    if (registration === undefined) throw new Error('No motion renderer is registered')
    return {
      renderer: registration.renderer,
      compositionDir: request.compositionDir,
      outputPath: request.outputPath,
      fps: request.fps ?? this.config.fps,
      quality: request.quality ?? this.config.quality,
      stills: request.stills ?? 0,
    }
  }

  /**
   * Bundle a composition folder with the registered renderer.
   * @param compositionDir - absolute folder holding `index.html`.
   * @returns the self-contained HTML document described at {@link MotionRenderer.bundle}.
   * @throws When no renderer is registered.
   */
  async bundle(compositionDir: string): Promise<string> {
    const registration = this.registration
    if (registration === undefined) throw new Error('No motion renderer is registered')
    return await registration.renderer.bundle(compositionDir)
  }

  /**
   * Render with exactly the resolved renderer.
   * @param spec - resolved render; a withdrawn or replaced renderer is rejected.
   * @param signal - caller cancellation.
   * @param onProgress - optional progress sink.
   * @returns the written film.
   */
  async render(spec: MotionRenderSpec, signal: AbortSignal, onProgress?: (progress: MotionProgress) => void): Promise<MotionRenderOutput> {
    signal.throwIfAborted()
    const registration = this.registration
    if (registration?.renderer !== spec.renderer) throw new Error('Resolved motion renderer is no longer registered')
    const combined = AbortSignal.any([signal, registration.lifetime.signal])
    const { renderer: _renderer, ...input } = spec
    const pending = spec.renderer.render(input, combined, onProgress)
    registration.pending.add(pending)
    try {
      const output = await pending
      combined.throwIfAborted()
      return output
    } finally {
      registration.pending.delete(pending)
    }
  }
}
