import { EventEmitter } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ToolDefinition, ToolRunContext } from '@aeven/tools'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Context as CordisContext, Service } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CODING_OAUTH_STATUS_PATH } from '../src/auth-routes.ts'
import { CAPABILITY_SETTINGS_PATH } from '../src/capability-routes.ts'
import type {
  CapabilitySettingsPatch,
  CapabilitySettingsScope,
  CapabilitySettingsService,
} from '../src/capability-settings.ts'
import { AttachmentId } from '@aeven/attachment'
import { MessageId, type LlmAdapter } from '@aeven/llm'
import { GrokImagineClient } from '../src/grok-imagine.ts'
import { IMAGINE_MEDIA_STORE_DIRNAME, LEGACY_IMAGINE_MEDIA_STORE_DIRNAME } from '../src/ids.ts'
import {
  CODEX_IMAGE_EDIT_TOOL,
  CODEX_IMAGE_GENERATE_TOOL,
} from '../src/capability-tools.ts'
import {
  CODEX_OAUTH_FAST_ROUTE,
  CODEX_OAUTH_ROUTE,
  CODING_OAUTH_ROUTES,
  GROK_BUILD_ROUTE,
  IMAGINE_CREDENTIAL_STATUS_PATH,
  SUBSCRIPTION_USAGE_PATH_PREFIX,
  XAI_PI_PROVIDER,
} from '../src/ids.ts'
import { apply, inject, name, type Config as PluginConfig } from '../src/index.ts'
import { MediaStore } from '../src/media-store.ts'
import { GrokBuildCredentialStore, grokBuildAuthPath, OAuthCredentialFileStore } from '../src/store.ts'
import { OAuthProviderSession } from '../src/oauth-session.ts'
import { GrokBuildSession } from '../src/session.ts'

/**
 * The Imagine client resolves its API origin through pinned DNS and the
 * `undici` transport, so a composition-level test needs both seams stubbed:
 * production pins DNS at connect time, which no test can reach.
 */
const imagineTransport = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('undici', async importOriginal => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: (input: unknown, init?: unknown): Promise<Response> =>
    imagineTransport.fetch(input, init) as Promise<Response>,
}))

vi.mock('node:dns/promises', async importOriginal => ({
  ...(await importOriginal<typeof import('node:dns/promises')>()),
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}))

/** A one-pixel PNG; the only image bytes these composition tests need. */
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154' +
    'a24f5f0000000049454e44ae426082',
  'hex',
)

const SIGNED_IN_GROK = {
  type: 'oauth',
  access: 'grok-access',
  refresh: 'grok-refresh',
  expires: Date.now() + 3_600_000,
} as const

function imagineJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function toolRunContext(options: { readonly agent?: ToolRunContext['agent'] | undefined } = {}): ToolRunContext {
  return {
    callId: 'call-1',
    rootCallId: 'call-1',
    name: 'tool',
    arguments: {},
    signal: new AbortController().signal,
    token: Symbol('tool-token'),
    ...(options.agent === undefined ? {} : { agent: options.agent }),
    deferContext: () => undefined,
    concludeTurn: () => undefined,
  } as unknown as ToolRunContext
}

afterEach(() => {
  vi.restoreAllMocks()
})

function runFiber(callback?: () => unknown) {
  let startupError: unknown
  let cleanup: (() => void | Promise<void>) | undefined
  const startup = Promise.resolve()
    .then(async () => {
      const result = await callback?.()
      if (typeof result === 'function') cleanup = result as () => void | Promise<void>
    })
    .catch((error: unknown) => {
      startupError = error
    })
  return {
    async await() {
      await startup
      if (startupError !== undefined) throw startupError
    },
    async dispose() {
      await startup
      await cleanup?.()
    },
  }
}

function requiredWebContext(): Context {
  return {
    webServer: { register: vi.fn(() => vi.fn()) },
    get: vi.fn(() => undefined),
    effect: vi.fn((setup: () => unknown) => setup()),
  } as unknown as Context
}

function liveSettings(initial: CapabilitySettingsPatch): {
  service: CapabilitySettingsService
  set(next: CapabilitySettingsPatch): void
  watcherCount(): number
} {
  let value: CapabilitySettingsPatch = initial
  const watchers = new Set<(next: unknown, prev: unknown) => void | Promise<void>>()
  const scope: CapabilitySettingsScope = {
    get: () => value,
    watch: (callback) => {
      watchers.add(callback)
      return () => {
        watchers.delete(callback)
      }
    },
    update: async () => undefined,
    replace: async () => undefined,
  }
  return {
    service: {
      writable: true,
      register: () => scope,
    },
    set(next) {
      const previous = value
      value = next
      for (const watcher of [...watchers]) void watcher(next, previous)
    },
    watcherCount: () => watchers.size,
  }
}

describe('plugin startup catalog initialization', () => {
  it('keeps owner Web routes alive across optional LLM activation, unload, and reload', async () => {
    vi.spyOn(GrokBuildSession.prototype, 'loadCachedCatalog').mockResolvedValue(undefined)
    vi.spyOn(OAuthProviderSession.prototype, 'loadCachedModels').mockResolvedValue(undefined)
    vi.spyOn(GrokBuildSession.prototype, 'refreshLiveCatalog').mockResolvedValue(undefined)
    const routeDisposers: Array<() => void | Promise<void>> = []
    const llmDisposers: Array<() => void | Promise<void>> = []
    const registeredPaths = new Set<string>()
    const register = vi.fn((route: { path: string }) => {
      if (registeredPaths.has(route.path)) throw new Error(`duplicate route ${route.path}`)
      registeredPaths.add(route.path)
      return () => {
        registeredPaths.delete(route.path)
      }
    })
    const registration = Object.assign(vi.fn(), { replace: vi.fn() })
    const registerAdapter = vi.fn(() => registration)
    let activateLlm: ((ctx: Context) => unknown) | undefined
    const webCtx = {
      webServer: { register },
      effect: vi.fn((setup: () => (() => void | Promise<void>) | undefined) => {
        const dispose = setup()
        if (dispose !== undefined) routeDisposers.push(dispose)
      }),
    } as unknown as Context
    const llmCtx = {
      llm: { registerAdapter, resolveModelInfo: vi.fn() },
      get: vi.fn(() => undefined),
      logger: () => ({ warn: vi.fn() }),
      effect: vi.fn((setup: () => (() => void | Promise<void>) | undefined) => {
        const dispose = setup()
        if (dispose !== undefined) llmDisposers.push(dispose)
      }),
      inject: vi.fn(),
    } as unknown as Context
    const ownerWebServer = webCtx.webServer
    const ownerLogger = (): { warn: ReturnType<typeof vi.fn> } => ({ warn: vi.fn() })
    const ownerEmit = vi.fn()
    const ownerEffect = vi.fn((setup: () => (() => void | Promise<void>) | undefined) => setup())
    const ownerGet = vi.fn(() => undefined)
    const ownerCtx = {
      webServer: ownerWebServer,
      logger: ownerLogger,
      emit: ownerEmit,
      effect: ownerEffect,
      get: ownerGet,
      inject: vi.fn((services: readonly string[], callback: (ctx: Context) => unknown) => {
        if (services.length === 1 && services[0] === 'llm') {
          activateLlm = callback
          return runFiber()
        }
        if (services.length === 1 && services[0] === 'webServer') return runFiber(() => callback(webCtx))
        return runFiber()
      }),
    } as unknown as Context
    const context = {
      webServer: ownerWebServer,
      logger: ownerLogger,
      emit: ownerEmit,
      effect: ownerEffect,
      get: ownerGet,
      inject: vi.fn((services: readonly string[], callback: (ctx: Context) => unknown) => {
        return services.length === 0 ? runFiber(() => callback(ownerCtx)) : runFiber()
      }),
    } as unknown as Context

    apply(context, {})
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(registeredPaths).toContain(CODING_OAUTH_STATUS_PATH)
    expect(registeredPaths).toContain(CAPABILITY_SETTINGS_PATH)
    expect(registerAdapter).not.toHaveBeenCalled()
    const webRouteCount = registeredPaths.size

    activateLlm?.(llmCtx)
    expect(registerAdapter).toHaveBeenCalledOnce()
    expect(registeredPaths.size).toBe(webRouteCount)

    await Promise.all(llmDisposers.map(dispose => Promise.resolve(dispose())))
    expect(registration).toHaveBeenCalledOnce()
    expect(registeredPaths.size).toBe(webRouteCount)

    llmDisposers.length = 0
    activateLlm?.(llmCtx)
    expect(registerAdapter).toHaveBeenCalledTimes(2)
    expect(registeredPaths.size).toBe(webRouteCount)
    await Promise.all(routeDisposers.map(dispose => Promise.resolve(dispose())))
  })

  it('applies composition capability defaults before an optional settings service exists', async () => {
    vi.spyOn(GrokBuildSession.prototype, 'loadCachedCatalog').mockResolvedValue(undefined)
    vi.spyOn(OAuthProviderSession.prototype, 'loadCachedModels').mockResolvedValue(undefined)
    vi.spyOn(GrokBuildSession.prototype, 'refreshLiveCatalog').mockResolvedValue(undefined)
    const registration = Object.assign(vi.fn(), { replace: vi.fn() })
    const registerSearchProvider = vi.fn(() => vi.fn())
    const requiredWeb = requiredWebContext()
    const child = {
      get: vi.fn((name: string) => (name === 'web' ? { registerSearchProvider } : undefined)),
      effect: vi.fn((setup: () => unknown) => setup()),
    }
    const context = {
      webServer: requiredWeb.webServer,
      logger: () => ({ warn: vi.fn() }),
      emit: vi.fn(),
      effect: vi.fn((setup: () => unknown) => setup()),
      llm: { registerAdapter: vi.fn(() => registration) },
      get: vi.fn(() => undefined),
      inject: vi.fn((services: readonly string[], callback: (ctx: unknown) => void) => {
        if (services.length === 0) return runFiber(() =>{  callback(context) })
        if (services.length === 1 && services[0] === 'llm') return runFiber(() =>{  callback(context) })
        if (services.length === 1 && services[0] === 'web') return runFiber(() =>{  callback(child) })
        if (services.length === 1 && services[0] === 'webServer') return runFiber(() =>{  callback(requiredWeb) })
        return runFiber()
      }),
    } as unknown as Context

    apply(context, { capabilities: { codexSearch: true, searchResults: 3 } })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(registerSearchProvider).toHaveBeenCalledOnce()
  })

  it('releases an obsolete settings watcher before reinjection and restores composition defaults on dispose', async () => {
    vi.spyOn(GrokBuildSession.prototype, 'loadCachedCatalog').mockResolvedValue(undefined)
    vi.spyOn(OAuthProviderSession.prototype, 'loadCachedModels').mockResolvedValue(undefined)
    vi.spyOn(GrokBuildSession.prototype, 'refreshLiveCatalog').mockResolvedValue(undefined)
    const registration = Object.assign(vi.fn(), { replace: vi.fn() })
    const searchReleases: ReturnType<typeof vi.fn>[] = []
    const registerSearchProvider = vi.fn(() => {
      const release = vi.fn()
      searchReleases.push(release)
      return release
    })
    const requiredWeb = requiredWebContext()
    let settingsInjection: ((ctx: Context) => void) | undefined
    const webCtx = {
      get: vi.fn((service: string) => (service === 'web' ? { registerSearchProvider } : undefined)),
      effect: vi.fn((setup: () => unknown) => setup()),
    } as unknown as Context
    const context = {
      logger: () => ({ warn: vi.fn() }),
      emit: vi.fn(),
      effect: vi.fn(),
      llm: { registerAdapter: vi.fn(() => registration) },
      get: vi.fn(() => undefined),
      inject: vi.fn((services: readonly string[], callback: (ctx: Context) => void) => {
        if (services.length === 0) return runFiber(() =>{  callback(context) })
        if (services.length === 1 && services[0] === 'llm') return runFiber(() =>{  callback(context) })
        if (services.length === 1 && services[0] === 'settings') {
          settingsInjection = callback
          return runFiber()
        }
        if (services.length === 1 && services[0] === 'web') return runFiber(() =>{  callback(webCtx) })
        if (services.length === 1 && services[0] === 'webServer') return runFiber(() =>{  callback(requiredWeb) })
        return runFiber()
      }),
    } as unknown as Context

    apply(context, { capabilities: { codexSearch: false } })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(settingsInjection).toBeDefined()
    expect(registerSearchProvider).not.toHaveBeenCalled()

    const attach = (live: ReturnType<typeof liveSettings>): (() => void) => {
      let release = (): void => undefined
      const child = {
        get: vi.fn((service: string) => (service === 'settings' ? live.service : undefined)),
        effect: vi.fn((setup: () => () => void) => {
          release = setup()
        }),
        inject: vi.fn(),
      } as unknown as Context
      settingsInjection!(child)
      return () =>{  release() }
    }

    const first = liveSettings({ codexSearch: true })
    attach(first)
    expect(first.watcherCount()).toBe(1)
    expect(registerSearchProvider).toHaveBeenCalledOnce()

    const second = liveSettings({ codexSearch: false })
    const releaseSecond = attach(second)
    expect(first.watcherCount()).toBe(0)
    expect(searchReleases[0]).toHaveBeenCalledOnce()
    first.set({ codexSearch: true })
    expect(registerSearchProvider).toHaveBeenCalledOnce()

    second.set({ codexSearch: true })
    expect(registerSearchProvider).toHaveBeenCalledTimes(2)
    releaseSecond()
    expect(second.watcherCount()).toBe(0)
    expect(searchReleases[1]).toHaveBeenCalledOnce()
  })

  it('aborts the Imagine client before asynchronous media cleanup during injected-service teardown', async () => {
    vi.spyOn(GrokBuildSession.prototype, 'loadCachedCatalog').mockResolvedValue(undefined)
    vi.spyOn(OAuthProviderSession.prototype, 'loadCachedModels').mockResolvedValue(undefined)
    vi.spyOn(GrokBuildSession.prototype, 'refreshLiveCatalog').mockResolvedValue(undefined)
    const order: string[] = []
    vi.spyOn(GrokImagineClient.prototype, 'dispose').mockImplementation(function disposeImagine(
      this: GrokImagineClient,
    ) {
      order.push('dispose')
    })
    vi.spyOn(MediaStore.prototype, 'cleanup').mockImplementation(async () => {
      order.push('cleanup')
      return { expiredArtifacts: 0, removedObjects: 0 }
    })
    const effects: Array<{ label?: string; setup: () => unknown }> = []
    const pending: Promise<unknown>[] = []
    const attachments = {
      imageLimits: {
        maxImageBytes: 1024,
        maxImagesPerMessage: 4,
        maxMessageImageBytes: 4096,
        mediaTypes: ['image/png'],
      },
      validateImage: async () => undefined,
      saveImage: async () => ({
        attachmentId: `sha256:${'ab'.repeat(32)}`,
        mediaType: 'image/png',
        bytes: 1,
        width: 1,
        height: 1,
      }),
      readImage: async () => {
        throw new Error('not used')
      },
    }
    const services: Record<string, unknown> = {
      tools: { register: vi.fn(() => vi.fn()) },
      attachments,
      credentials: { resolve: async () => undefined },
      webServer: { register: vi.fn(() => vi.fn()) },
    }
    const toolCtx: Context = {
      ...services,
      get: vi.fn((service: string) => services[service]),
      effect: vi.fn((setup: () => unknown, label?: string) => {
        effects.push({ setup, ...(label === undefined ? {} : { label }) })
      }),
      // The media seam is optional: this composition mounts none, so the
      // injected callback runs against a context whose `get("media")` is
      // undefined and the provider registration is skipped.
      inject: vi.fn((_requested: readonly string[], callback: (ctx: Context) => unknown) => {
        callback(toolCtx)
      }),
    } as unknown as Context
    const registration = Object.assign(vi.fn(), { replace: vi.fn() })
    const context = {
      logger: () => ({ warn: vi.fn() }),
      emit: vi.fn(),
      effect: vi.fn(),
      llm: {
        registerAdapter: vi.fn(() => registration),
        resolveModelInfo: vi.fn(),
      },
      get: vi.fn(() => undefined),
      inject: vi.fn((requested: readonly string[], callback: (ctx: Context) => unknown) => {
        if (requested.length === 0) return runFiber(() => callback(context))
        if (requested.length === 1 && requested[0] === 'llm') return runFiber(() => callback(context))
        if (requested.length === 1 && requested[0] === 'webServer') return runFiber(() => callback(toolCtx))
        if (requested.join(',') !== 'tools,attachments,credentials,webServer') return runFiber()
        const fiber = runFiber(() => callback(toolCtx))
        pending.push(fiber.await())
        return fiber
      }),
    } as unknown as Context

    apply(context, {})
    await new Promise<void>(resolve => setImmediate(resolve))
    await Promise.all(pending)
    order.length = 0
    expect(effects.some(effect => effect.label?.includes('imagine download routes') === true)).toBe(true)
    const lifetime = effects.find(effect => effect.label?.includes('Imagine client and media lifetime') === true)
    expect(lifetime).toBeDefined()
    const dispose = lifetime!.setup()
    expect(dispose).toBeTypeOf('function')
    await (dispose as () => void | Promise<void>)()
    expect(order).toEqual(['dispose', 'cleanup'])
  })

  it('contains cache and refresh failures while registering the adapter', async () => {
    vi.spyOn(GrokBuildSession.prototype, 'loadCachedCatalog').mockRejectedValue(new Error('grok cache failed'))
    vi.spyOn(OAuthProviderSession.prototype, 'loadCachedModels').mockRejectedValue(new Error('oauth cache failed'))
    const refresh = vi
      .spyOn(GrokBuildSession.prototype, 'refreshLiveCatalog')
      .mockRejectedValue(new Error('refresh failed'))
    // The live refresh runs only for a signed-in Grok account; stub one rather than read the host's store.
    vi.spyOn(GrokBuildCredentialStore.prototype, 'read')
      .mockImplementation(async providerId => providerId === XAI_PI_PROVIDER ? SIGNED_IN_GROK : undefined)
    const warn = vi.fn()
    const registration = Object.assign(vi.fn(), { replace: vi.fn() })
    const registerAdapter = vi.fn(() => registration)
    const requiredWeb = requiredWebContext()
    const context = {
      webServer: requiredWeb.webServer,
      logger: () => ({ warn }),
      emit: vi.fn(),
      effect: vi.fn((setup: () => unknown) => setup()),
      llm: { registerAdapter },
      get: vi.fn(() => undefined),
      inject: vi.fn((requested: readonly string[], callback: (ctx: Context) => unknown) => {
        if (requested.length === 0) return runFiber(() => callback(context))
        if (requested.length === 1 && requested[0] === 'llm') return runFiber(() => callback(context))
        if (requested.length === 1 && requested[0] === 'webServer') return runFiber(() => callback(requiredWeb))
        return runFiber()
      }),
    } as unknown as Context

    apply(context, {})
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(registerAdapter).toHaveBeenCalledOnce()

    // The pass retries on its own schedule, so only its occurrence is pinned here; the
    // containment is what the warnings below assert.
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalled()
    })

    // Both containments are reported after the refresh this test waited for, on
    // their own schedule, so the assertions wait for the logger as well.
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        'the model selection or a cached model listing could not be loaded; every model stays selected',
      )
      expect(warn).toHaveBeenCalledWith('a subscription model sync failed; the last listing stays in use')
    })
  })
})

/** One owner Web route as the plugin registered it. */
interface CapturedRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** Captured response state for one invocation of a registered route. */
interface RouteResult {
  readonly status: number
  readonly json: unknown
}

class OwnerWebServer extends Service {
  readonly routes = new Map<string, CapturedRoute>()

  constructor(ctx: Context) {
    super(ctx, 'webServer')
  }

  register(route: CapturedRoute): () => void {
    if (this.routes.has(route.path)) throw new Error(`duplicate route ${route.path}`)
    this.routes.set(route.path, route)
    return () => {
      this.routes.delete(route.path)
    }
  }

  /** Drive one registered route the way the real Web server would. */
  async request(
    path: string,
    options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<RouteResult> {
    const cleaned = path.split('?')[0]!
    const route =
      this.routes.get(cleaned) ??
      [...this.routes.values()].find(candidate => candidate.kind === 'prefix' && cleaned.startsWith(candidate.path))
    if (route === undefined) throw new Error(`no route registered for ${path}`)
    const request = fakeRequest(path, options)
    const response = fakeResponse()
    await route.handler(request, response.res)
    return { status: response.state.status, json: response.state.json }
  }
}

class OwnerTools extends Service {
  readonly registered = new Map<string, ToolDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  register(definition: ToolDefinition): () => void {
    this.registered.set(definition.name, definition)
    return () => {
      this.registered.delete(definition.name)
    }
  }
}

class OwnerAttachments extends Service {
  readonly saved: Array<{ id: string; mediaType: string; bytes: number }> = []
  private readonly bodies = new Map<string, Uint8Array>()
  /** Store-side media type to hand back, standing in for a PNG-only fake. */
  forcedMediaType: string | undefined
  /** Hand a read back a store-owned identifier that would canonicalize outside the workspace root. */
  hostileReadId: string | undefined

  constructor(ctx: Context) {
    super(ctx, 'attachments')
  }

  readonly imageLimits = {
    maxImageBytes: 5 * 1024 * 1024,
    maxImagesPerMessage: 4,
    maxMessageImageBytes: 16 * 1024 * 1024,
    mediaTypes: ['image/png', 'image/jpeg'],
  }

  async validateImage(): Promise<void> {
    return undefined
  }

  async saveImage(input: { data: Uint8Array; mediaType: string; name?: string }) {
    const index = this.saved.length
    const attachmentId = `sha256:${index.toString(16).padStart(2, '0').repeat(32)}`
    const mediaType = this.forcedMediaType ?? input.mediaType
    this.saved.push({ id: attachmentId, mediaType, bytes: input.data.byteLength })
    this.bodies.set(attachmentId, input.data)
    return {
      attachmentId,
      mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      ...(input.name === undefined ? {} : { name: input.name }),
    }
  }

  /** Every reference the LLM request-image seam asked this store for. */
  readonly imageRequests: string[] = []

  async readImageRequest(ref: { attachmentId: string }): Promise<never> {
    this.imageRequests.push(ref.attachmentId)
    throw new Error('this fixture serves no request-image payloads')
  }

  async readImage(ref: { attachmentId: string; mediaType: string }) {
    const stored =
      this.hostileReadId === undefined
        ? ref
        : { attachmentId: this.hostileReadId, mediaType: this.forcedMediaType ?? ref.mediaType }
    return { ref: stored, data: this.bodies.get(ref.attachmentId) ?? new Uint8Array() }
  }
}

class OwnerCredentials extends Service {
  /** Set to make `resolve` reject, standing in for an unavailable credential backend. */
  failing = false

  constructor(
    ctx: Context,
    readonly value: string | undefined,
  ) {
    super(ctx, 'credentials')
  }

  async resolve(): Promise<{ value: string } | undefined> {
    if (this.failing) throw new Error('credential backend unavailable')
    return this.value === undefined ? undefined : { value: this.value }
  }

  async describe(): Promise<{ configured: boolean; source: string; writable: boolean }> {
    return {
      configured: this.value !== undefined,
      source: 'credentials',
      writable: true,
    }
  }
}

/** Push one contributed entry and return the disposer that withdraws exactly it. */
function capturedRegistration<T>(entries: T[], entry: T): () => void {
  entries.push(entry)
  return () => {
    const index = entries.indexOf(entry)
    if (index >= 0) entries.splice(index, 1)
  }
}

/** The part of a generated-media image provider these tests observe. */
interface SeamImageProvider {
  readonly id: string
}

class OwnerMedia extends Service {
  readonly providers: SeamImageProvider[] = []

  constructor(ctx: Context) {
    super(ctx, 'media')
  }

  registerImageProvider(provider: SeamImageProvider): () => void {
    return capturedRegistration(this.providers, provider)
  }
}

class OwnerSandboxPolicy extends Service {
  constructor(
    ctx: Context,
    readonly workspaceRoot: string,
  ) {
    super(ctx, 'sandboxPolicy')
  }

  resolve(): { workspaceRoot: string } {
    return { workspaceRoot: this.workspaceRoot }
  }
}

class OwnerSearchRegistry extends Service {
  readonly providers: Array<{ id: string; available(): boolean; search(request: never, signal?: AbortSignal): unknown }> = []

  constructor(ctx: Context) {
    super(ctx, 'web')
  }

  registerSearchProvider(provider: never): () => void {
    return capturedRegistration(this.providers, provider)
  }
}

class OwnerSettings extends Service {
  private value: CapabilitySettingsPatch
  private revision = 0
  private readonly watchers = new Set<(next: unknown, prev: unknown) => void | Promise<void>>()

  /** Make the scope's watcher disposer throw, standing in for a failing settings provider. */
  failingWatchRelease = false

  constructor(ctx: Context, initial: CapabilitySettingsPatch = {}) {
    super(ctx, 'settings')
    this.value = initial
  }

  readonly writable = true

  register(): CapabilitySettingsScope {
    return {
      get: () => ({ ...this.value }),
      watch: (callback) => {
        this.watchers.add(callback)
        return () => {
          this.watchers.delete(callback)
          if (this.failingWatchRelease) throw new Error('settings provider refused to release the watcher')
        }
      },
      update: async (patch) => {
        this.write({ ...this.value, ...(patch as CapabilitySettingsPatch) })
      },
      replace: async (section) => {
        this.write({ ...(section as CapabilitySettingsPatch) })
      },
    }
  }

  get(): CapabilitySettingsPatch {
    return { ...this.value }
  }

  async update(_ns: string, patch: object): Promise<void> {
    this.write({ ...this.value, ...(patch as CapabilitySettingsPatch) })
  }

  async replace(_ns: string, section: object): Promise<void> {
    this.write({ ...(section as CapabilitySettingsPatch) })
  }

  /** Commit a new user section the way the Host settings service would. */
  write(next: CapabilitySettingsPatch): void {
    const previous = this.value
    this.value = next
    this.revision += 1
    for (const watcher of [...this.watchers]) void watcher({ ...next }, { ...previous })
  }
}

function fakeRequest(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> },
): IncomingMessage {
  const emitter = new EventEmitter() as unknown as Record<string, unknown>
  emitter['method'] = options.method ?? 'GET'
  emitter['url'] = path
  emitter['headers'] = { host: '127.0.0.1:3080', ...(options.headers ?? {}) }
  emitter['socket'] = { remoteAddress: '127.0.0.1' }
  emitter['resume'] = () => undefined
  const emit = EventEmitter.prototype.emit.bind(emitter) as (event: string, ...args: unknown[]) => boolean
  setImmediate(() => {
    if (options.body !== undefined) emit('data', Buffer.from(JSON.stringify(options.body)))
    emit('end')
  })
  return emitter as unknown as IncomingMessage
}

function fakeResponse(): { res: ServerResponse; state: { status: number; json: unknown } } {
  const state = { status: 0, json: undefined as unknown }
  const res = {
    writeHead(status: number) {
      state.status = status
      return res
    },
    end(body?: unknown) {
      if (typeof body !== 'string') return
      try {
        state.json = JSON.parse(body)
      } catch {
        state.json = undefined
      }
    },
  }
  return { res: res as unknown as ServerResponse, state }
}

interface OwnerHarness {
  readonly root: CordisContext
  readonly webServer: OwnerWebServer
  readonly tools: OwnerTools
  readonly attachments: OwnerAttachments
  readonly credentials: OwnerCredentials
  readonly media: OwnerMedia | undefined
  readonly sandbox: OwnerSandboxPolicy | undefined
  readonly settings: OwnerSettings | undefined
  readonly search: OwnerSearchRegistry | undefined
  readonly grok: GrokBuildSession[]
  readonly subscriptions: OAuthProviderSession[]
  dispose(): Promise<void>
}

interface BootOptions {
  readonly config?: PluginConfig
  readonly media?: boolean
  readonly sandbox?: boolean
  readonly settings?: boolean
  readonly search?: boolean
  /** `undefined` leaves no API key configured; `null` omits the service entirely. */
  readonly apiKey?: string | undefined | null
  /** Fault injection before the plugin starts. */
  readonly configure?: (services: {
    credentials: OwnerCredentials
    attachments: OwnerAttachments
    settings: OwnerSettings | undefined
  }) => void
  readonly ready?: (harness: OwnerHarness) => void
}

describe('owner composition over a real Cordis context', () => {
  let home: string
  let previousHome: string | undefined
  let workspaceRoot: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'avn-owner-startup-'))
    previousHome = process.env.AVN_HOME
    process.env.AVN_HOME = home
    workspaceRoot = join(home, 'workspace')
    await mkdir(workspaceRoot, { recursive: true })
  })

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.AVN_HOME
    else process.env.AVN_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  })

  async function bootOwner(options: BootOptions = {}): Promise<OwnerHarness> {
    const subscriptions: OAuthProviderSession[] = []
    const grokSessions: GrokBuildSession[] = []
    vi.spyOn(OAuthProviderSession.prototype, 'loadCachedModels').mockImplementation(async function (
      this: OAuthProviderSession,
    ) {
      subscriptions.push(this)
    })
    vi.spyOn(GrokBuildSession.prototype, 'loadCachedCatalog').mockImplementation(async function (
      this: GrokBuildSession,
    ) {
      grokSessions.push(this)
    })
    vi.spyOn(GrokBuildSession.prototype, 'refreshLiveCatalog').mockResolvedValue(undefined)
    const root = new CordisContext()
    const webServer = new OwnerWebServer(root)
    const tools = new OwnerTools(root)
    const attachments = new OwnerAttachments(root)
    const credentials =
      options.apiKey === null
        ? undefined
        : new OwnerCredentials(root, options.apiKey === undefined ? 'xai-api-key' : options.apiKey)
    const media = options.media === true ? new OwnerMedia(root) : undefined
    const sandbox = options.sandbox === true ? new OwnerSandboxPolicy(root, workspaceRoot) : undefined
    const settings = options.settings === true ? new OwnerSettings(root) : undefined
    const search = options.search === true ? new OwnerSearchRegistry(root) : undefined
    options.configure?.({
      credentials: credentials as OwnerCredentials,
      attachments,
      settings,
    })
    const fiber = root.plugin({ name, inject, apply }, options.config ?? {})
    const harness: OwnerHarness = {
      root,
      webServer,
      tools,
      attachments,
      credentials: credentials as OwnerCredentials,
      media,
      sandbox,
      settings,
      search,
      grok: grokSessions,
      subscriptions,
      dispose: () => fiber.dispose(),
    }
    await fiber
    await vi.waitFor(() => {
      expect(webServer.routes.size).toBeGreaterThan(0)
    })
    if (options.ready !== undefined) await vi.waitFor(() => { options.ready!(harness) })
    return harness
  }

  it('serves the capability snapshot, credential status, and compatibility over the owner routes', async () => {
    const app = await bootOwner({
      media: true,
      sandbox: true,
      settings: true,
      ready: (harness) => { expect(harness.tools.registered.size).toBeGreaterThan(0) },
    })

    const snapshot = await app.webServer.request(CAPABILITY_SETTINGS_PATH)
    expect(snapshot.status).toBe(200)
    expect(snapshot.json).toMatchObject({ ns: 'coding-subscription-oauth', writable: true })
    const revision = (snapshot.json as { revision: number }).revision

    const patched = await app.webServer.request(CAPABILITY_SETTINGS_PATH, {
      method: 'PATCH',
      body: { expectedRevision: revision, patch: { codexSearch: true } },
    })
    expect(patched.status).toBe(200)
    expect((patched.json as { value: { codexSearch: boolean } }).value.codexSearch).toBe(true)

    const replaced = await app.webServer.request(CAPABILITY_SETTINGS_PATH, {
      method: 'PUT',
      body: { expectedRevision: (patched.json as { revision: number }).revision, value: { searchResults: 3 } },
    })
    expect(replaced.status).toBe(200)
    expect((replaced.json as { value: { searchResults: number } }).value.searchResults).toBe(3)

    const credential = await app.webServer.request(IMAGINE_CREDENTIAL_STATUS_PATH)
    expect(credential.status).toBe(200)
    expect(credential.json).toEqual({ configured: true, source: 'credentials', writable: true })

    const status = await app.webServer.request(CODING_OAUTH_STATUS_PATH)
    expect(status.status).toBe(200)
    expect(status.json).toMatchObject({
      accessMode: 'loopback',
      uiOwner: 'standalone',
      compatibility: { uiOwner: 'standalone', accessMode: 'loopback' },
    })

    await app.dispose()
  })

  it('registers both subscription image providers, offering Codex only once signed in', async () => {
    const app = await bootOwner({
      media: true,
      sandbox: true,
      ready: (harness) => { expect(harness.media!.providers).toHaveLength(2) },
    })

    expect(app.media!.providers.map(provider => provider.id).sort()).toEqual(['codex-subscription', 'grok-subscription'])
    const codex = app.media!.providers.find(provider => provider.id === 'codex-subscription') as unknown as { available(): boolean }
    expect(codex.available()).toBe(false)

    await app.dispose()
  })

  it('registers the Codex search provider only while the capability is enabled', async () => {
    const app = await bootOwner({
      search: true,
      media: true,
      sandbox: true,
      config: { capabilities: { codexSearch: true } },
      ready: (harness) => { expect(harness.search!.providers).toHaveLength(1) },
    })

    expect(app.search!.providers[0]!.id).toBe('codex-oauth-search')
    expect(app.search!.providers[0]!.available()).toBe(true)

    vi.spyOn(OAuthProviderSession.prototype, 'visibleModels').mockReturnValue([])
    expect(app.search!.providers[0]!.available()).toBe(false)

    await app.dispose()
    expect(app.search!.providers).toEqual([])
  })
})

describe('Imagine tool execution over the owner composition', () => {
  let home: string
  let previousHome: string | undefined
  let workspaceRoot: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'avn-imagine-tool-'))
    previousHome = process.env.AVN_HOME
    process.env.AVN_HOME = home
    workspaceRoot = join(home, 'workspace')
    await mkdir(workspaceRoot, { recursive: true })
    imagineTransport.fetch.mockReset()
  })

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.AVN_HOME
    else process.env.AVN_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  })

  /** Boot the owner composition and hand back the live sessions it created. */
  async function bootImagine(config: PluginConfig, apiKey: string | undefined) {
    const grokSessions: GrokBuildSession[] = []
    vi.spyOn(OAuthProviderSession.prototype, 'loadCachedModels').mockResolvedValue(undefined)
    vi.spyOn(GrokBuildSession.prototype, 'loadCachedCatalog').mockImplementation(async function (
      this: GrokBuildSession,
    ) {
      grokSessions.push(this)
    })
    vi.spyOn(GrokBuildSession.prototype, 'refreshLiveCatalog').mockResolvedValue(undefined)
    const root = new CordisContext()
    const webServer = new OwnerWebServer(root)
    const tools = new OwnerTools(root)
    const attachments = new OwnerAttachments(root)
    const credentials = new OwnerCredentials(root, apiKey)
    const media = new OwnerMedia(root)
    const sandbox = new OwnerSandboxPolicy(root, workspaceRoot)
    const fiber = root.plugin({ name, inject, apply }, config)
    await fiber
    return { root, webServer, tools, attachments, credentials, media, sandbox, grokSessions, fiber }
  }

  it('runs the Imagine image tool on the subscription route and copies the image into the workspace', async () => {
    imagineTransport.fetch.mockResolvedValue(
      imagineJsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }] }),
    )
    const app = await bootImagine({}, undefined)
    const grok = app.grokSessions[0]!
    await grok.store.modify(XAI_PI_PROVIDER, async () => SIGNED_IN_GROK)
    grok.notifyCredentialChange()
    await vi.waitFor(() => {
      expect(app.tools.registered.has('grok_imagine_image')).toBe(true)
    })

    const result = (await app.tools.registered
      .get('grok_imagine_image')!
      .execute(
        { prompt: 'a cat' },
        toolRunContext({ agent: { options: {}, session: {} } as unknown as ToolRunContext['agent'] }),
      )) as {
      model: string
      images: unknown[]
      workspacePaths?: string[]
    }

    expect(result.model).toBe('grok-imagine-image-2.0')
    expect(result.images).toHaveLength(1)
    expect(app.attachments.saved).toMatchObject([{ mediaType: 'image/png', bytes: PNG_BYTES.byteLength }])
    expect(result.workspacePaths).toEqual([expect.stringMatching(/^images\/.+\.png$/u)])
    const written = await readFile(join(workspaceRoot, result.workspacePaths![0]!))
    expect(written.equals(PNG_BYTES)).toBe(true)
    // The subscription route is the one the official CLI takes, and it inlines
    // base64 rather than handing back a signed URL to download.
    const request = imagineTransport.fetch.mock.calls[0]![0] as URL
    expect(request.origin).toBe('https://cli-chat-proxy.grok.com')
    expect(JSON.parse((imagineTransport.fetch.mock.calls[0]![1] as { body: string }).body)).toMatchObject({
      response_format: 'b64_json',
    })

    await app.fiber.dispose()
  })

  it('prefers a configured XAI_API_KEY and downloads the URL row the developer API returns', async () => {
    imagineTransport.fetch.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/v1/images/generations')) {
        return imagineJsonResponse({ data: [{ url: 'https://imgen.x.ai/generated.png' }] })
      }
      return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } })
    })
    const app = await bootImagine({}, 'xai-api-key')
    await vi.waitFor(() => {
      expect(app.tools.registered.has('grok_imagine_image')).toBe(true)
    })

    const result = (await app.tools.registered
      .get('grok_imagine_image')!
      .execute({ prompt: 'a cat' }, toolRunContext())) as { images: unknown[]; workspacePaths?: string[] }

    expect(result.images).toHaveLength(1)
    expect(result.workspacePaths).toHaveLength(1)
    const request = imagineTransport.fetch.mock.calls[0]![0] as URL
    expect(request.origin).toBe('https://api.x.ai')
    expect(JSON.parse((imagineTransport.fetch.mock.calls[0]![1] as { body: string }).body)).toMatchObject({
      response_format: 'url',
    })
    expect(String(imagineTransport.fetch.mock.calls[1]![0])).toBe('https://imgen.x.ai/generated.png')

    await app.fiber.dispose()
  })

  it('fails an Imagine call by name when a pinned xai-api route has no API key', async () => {
    imagineTransport.fetch.mockResolvedValue(imagineJsonResponse({ data: [] }))
    const app = await bootImagine({ imagineTransport: 'xai-api' }, undefined)
    const grok = app.grokSessions[0]!
    await grok.store.modify(XAI_PI_PROVIDER, async () => SIGNED_IN_GROK)
    grok.notifyCredentialChange()
    await vi.waitFor(() => {
      expect(app.tools.registered.has('grok_imagine_image')).toBe(true)
    })

    await expect(
      app.tools.registered.get('grok_imagine_image')!.execute({ prompt: 'a cat' }, toolRunContext()),
    ).rejects.toMatchObject({
      code: 'MISSING_CREDENTIAL',
      message: expect.stringContaining('XAI_API_KEY') as string,
    })
    expect(imagineTransport.fetch).not.toHaveBeenCalled()

    await app.fiber.dispose()
  })

  it.each([
    ['video/mp4', Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex'), '.mp4'],
    ['video/webm', Buffer.from('1a45dfa39f4286810142f7810142f2810442f381', 'hex'), '.webm'],
  ])('runs the Imagine video tools and copies a completed %s into the workspace', async (mediaType, video, extension) => {
    imagineTransport.fetch.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/v1/videos/generations')) return imagineJsonResponse({ request_id: 'req_video_1' })
      if (url.includes('/v1/videos/req_video_1')) {
        return imagineJsonResponse({ status: 'done', video: { url: 'https://videogen.x.ai/v.bin' } })
      }
      return new Response(video, { status: 200, headers: { 'content-type': mediaType } })
    })
    const app = await bootImagine({}, 'xai-api-key')
    await vi.waitFor(() => {
      expect(app.tools.registered.has('grok_imagine_video_status')).toBe(true)
    })

    const started = (await app.tools.registered
      .get('grok_imagine_video')!
      .execute({ prompt: 'a kite' }, toolRunContext())) as { requestId: string; status: string }
    expect(started).toMatchObject({ requestId: 'req_video_1', status: 'pending' })

    const completed = (await app.tools.registered
      .get('grok_imagine_video_status')!
      .execute({ requestId: started.requestId }, toolRunContext())) as {
      status: string
      path?: string
      workspacePath?: string
    }
    expect(completed.status).toBe('completed')
    expect(completed.workspacePath).toMatch(new RegExp(`^videos/.*${extension.replace('.', '\\.')}$`, 'u'))
    expect((await readFile(join(workspaceRoot, completed.workspacePath!))).equals(video)).toBe(true)

    // The completed artifact stays reachable on the plugin's own media route,
    // which streams the stored bytes rather than the upstream URL.
    const served = await app.webServer.request(completed.path!)
    expect(served.status).toBe(200)

    await app.fiber.dispose()
  })
})

describe('owner composition fault containment', () => {
  let home: string
  let previousHome: string | undefined
  let workspaceRoot: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'avn-owner-faults-'))
    previousHome = process.env.AVN_HOME
    process.env.AVN_HOME = home
    workspaceRoot = join(home, 'workspace')
    await mkdir(workspaceRoot, { recursive: true })
    imagineTransport.fetch.mockReset()
    imagineTransport.fetch.mockResolvedValue(
      imagineJsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }] }),
    )
  })

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.AVN_HOME
    else process.env.AVN_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  })

  /** Boot with the same real services the injected-service suite uses, plus fault injection. */
  async function bootFaulty(
    options: {
      readonly config?: PluginConfig
      /** `null` omits the credential service entirely; `noApiKey` keeps it without a key. */
      readonly apiKey?: string | undefined | null
      readonly noApiKey?: boolean
      readonly sandbox?: boolean
      readonly settings?: boolean
      readonly media?: boolean
      readonly configure?: (services: {
        credentials: OwnerCredentials
        attachments: OwnerAttachments
        settings: OwnerSettings | undefined
      }) => void
    } = {},
  ) {
    const grokSessions: GrokBuildSession[] = []
    vi.spyOn(OAuthProviderSession.prototype, 'loadCachedModels').mockResolvedValue(undefined)
    vi.spyOn(GrokBuildSession.prototype, 'loadCachedCatalog').mockImplementation(async function (
      this: GrokBuildSession,
    ) {
      grokSessions.push(this)
    })
    vi.spyOn(GrokBuildSession.prototype, 'refreshLiveCatalog').mockResolvedValue(undefined)
    const root = new CordisContext()
    const webServer = new OwnerWebServer(root)
    const tools = new OwnerTools(root)
    const attachments = new OwnerAttachments(root)
    const credentials =
      options.apiKey === null
        ? undefined
        : new OwnerCredentials(
          root,
          options.noApiKey === true ? undefined : (options.apiKey === undefined ? 'xai-api-key' : options.apiKey),
        )
    const media = options.media === true ? new OwnerMedia(root) : undefined
    const sandbox = options.sandbox === true ? new OwnerSandboxPolicy(root, workspaceRoot) : undefined
    const settings = options.settings === true ? new OwnerSettings(root) : undefined
    options.configure?.({ credentials: credentials as OwnerCredentials, attachments, settings })
    const fiber = root.plugin({ name, inject, apply }, options.config ?? {})
    await fiber
    return { root, webServer, tools, attachments, credentials, media, sandbox, settings, grokSessions, fiber }
  }

  it('reports an unconfigured Imagine credential and refuses capability writes without a settings provider', async () => {
    const app = await bootFaulty({ apiKey: null })

    const credential = await app.webServer.request(IMAGINE_CREDENTIAL_STATUS_PATH)
    expect(credential.status).toBe(200)
    expect(credential.json).toEqual({ configured: false, source: 'unknown', writable: false })

    const snapshot = await app.webServer.request(CAPABILITY_SETTINGS_PATH)
    const written = await app.webServer.request(CAPABILITY_SETTINGS_PATH, {
      method: 'PATCH',
      body: { expectedRevision: (snapshot.json as { revision: number }).revision, patch: { codexSearch: true } },
    })
    expect(written.status).toBe(503)
    expect(written.json).toMatchObject({ error: 'request failed', code: 'SETTINGS_PROVIDER_ABSENT' })

    await app.fiber.dispose()
  })

  it('treats an unreadable credential file as a signed-out session', async () => {
    const read = vi
      .spyOn(OAuthCredentialFileStore.prototype, 'read')
      .mockRejectedValue(new Error('credential file unreadable'))
    const app = await bootFaulty({ noApiKey: true })
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalled()
    })
    // The failed probe may not escape: the owner routes stay served and no
    // media tool is advertised for a backend that just failed to answer.
    expect(app.webServer.routes.has(CODING_OAUTH_STATUS_PATH)).toBe(true)
    expect(app.tools.registered.has('grok_imagine_image')).toBe(false)

    await app.fiber.dispose()
  })

  it('contains a credential resolver that rejects the readiness probe', async () => {
    const app = await bootFaulty({
      media: true,
      sandbox: true,
      configure: (services) => {
        services.credentials.failing = true
      },
    })
    await vi.waitFor(() => {
      expect([...app.webServer.routes.keys()].some(path => path.includes('/imagine/'))).toBe(true)
    })

    expect(app.webServer.routes.has(CODING_OAUTH_STATUS_PATH)).toBe(true)
    expect(app.tools.registered.has('grok_imagine_image')).toBe(false)

    await app.fiber.dispose()
  })

  it('stops advertising a Grok session that disappears before the tool runs', async () => {
    const app = await bootFaulty({ media: true, sandbox: true, noApiKey: true })
    const grok = app.grokSessions[0]!
    await grok.store.modify(XAI_PI_PROVIDER, async () => SIGNED_IN_GROK)
    grok.notifyCredentialChange()
    await vi.waitFor(() => {
      expect(app.tools.registered.has('grok_imagine_image')).toBe(true)
    })

    await grok.logout()
    grok.notifyCredentialChange()
    await new Promise(resolve => setTimeout(resolve, 200))
    await vi.waitFor(() => {
      expect(app.tools.registered.has('grok_imagine_image')).toBe(false)
    })
    expect(app.tools.registered.has('grok_imagine_video')).toBe(false)

    await app.fiber.dispose()
  })

  it('omits the workspace copy when the deployment mounts no sandbox policy', async () => {
    const app = await bootFaulty({ media: true, apiKey: 'xai-api-key', config: { imagineApiTimeoutMs: 30_000 } })
    await vi.waitFor(() => {
      expect(app.tools.registered.has('grok_imagine_image')).toBe(true)
    })

    const result = (await app.tools.registered
      .get('grok_imagine_image')!
      .execute({ prompt: 'a cat' }, toolRunContext())) as { images: unknown[]; workspacePaths?: string[] }

    expect(result.images).toHaveLength(1)
    expect(result).not.toHaveProperty('workspacePaths')

    await app.fiber.dispose()
  })

  it('refuses a store-owned identifier that would escape the workspace root', async () => {
    const app = await bootFaulty({
      media: true,
      sandbox: true,
      apiKey: 'xai-api-key',
      configure: (services) => {
        // A store that hands back an id-shaped name whose media type adds no
        // extension, so the joined path canonicalizes to the root itself.
        services.attachments.hostileReadId = '..'
        services.attachments.forcedMediaType = 'application/octet-stream'
      },
    })
    await vi.waitFor(() => {
      expect(app.tools.registered.has('grok_imagine_image')).toBe(true)
    })

    const result = (await app.tools.registered
      .get('grok_imagine_image')!
      .execute({ prompt: 'a cat' }, toolRunContext())) as { images: unknown[]; workspacePaths?: string[] }

    expect(result.images).toHaveLength(1)
    expect(result).not.toHaveProperty('workspacePaths')
    await expect(readFile(join(home, 'outside'), 'utf8')).rejects.toThrow()

    await app.fiber.dispose()
  })

  it('keeps the deployment serving after an llm/adapters-updated listener throws', async () => {
    const app = await bootFaulty({ media: true, sandbox: true })
    const grok = app.grokSessions[0]!
    app.root.on('llm/adapters-updated', () => {
      throw new Error('broken catalog observer')
    })

    await expect(grok.store.modify(XAI_PI_PROVIDER, async () => SIGNED_IN_GROK)).resolves.toBeDefined()
    expect(() =>{  grok.notifyCredentialChange() }).not.toThrow()
    expect(await grok.store.read(XAI_PI_PROVIDER)).toMatchObject({ type: 'oauth' })

    await app.fiber.dispose()
  })

  it('silences a catalog notification that arrives after disposal', async () => {
    const app = await bootFaulty({ media: true, sandbox: true })
    const grok = app.grokSessions[0]!
    const emit = vi.spyOn(app.root, 'emit')
    await app.fiber.dispose()
    emit.mockClear()

    grok.notifyCredentialChange()
    expect(emit).not.toHaveBeenCalled()
  })

  it('moves a pre-rename Imagine media directory into the current name on startup', async () => {
    const stateDir = dirname(grokBuildAuthPath())
    await mkdir(join(stateDir, LEGACY_IMAGINE_MEDIA_STORE_DIRNAME), { recursive: true })
    await writeFile(join(stateDir, LEGACY_IMAGINE_MEDIA_STORE_DIRNAME, 'kept.bin'), 'kept')
    const app = await bootFaulty({ media: true, sandbox: true })
    await vi.waitFor(() => {
      expect(app.tools.registered.has('grok_imagine_image')).toBe(true)
    })

    await expect(
      readFile(join(stateDir, IMAGINE_MEDIA_STORE_DIRNAME, 'kept.bin'), 'utf8'),
    ).resolves.toBe('kept')

    await app.fiber.dispose()
  })

  it('contains a failing capability-settings watcher release during disposal', async () => {
    const app = await bootFaulty({
      media: true,
      sandbox: true,
      settings: true,
      configure: (services) => {
        if (services.settings !== undefined) services.settings.failingWatchRelease = true
      },
    })
    expect(app.settings!.get()).toEqual({})

    await expect(app.fiber.dispose()).resolves.toBeUndefined()
    expect(app.webServer.routes.size).toBe(0)
  })

  it.each([
    ['image/jpeg', '.jpg'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif'],
  ])('names a stored %s artifact with its own extension', async (mediaType, extension) => {
    const app = await bootFaulty({
      media: true,
      sandbox: true,
      apiKey: 'xai-api-key',
      configure: (services) => {
        services.attachments.forcedMediaType = mediaType
      },
    })
    await vi.waitFor(() => {
      expect(app.tools.registered.has('grok_imagine_image')).toBe(true)
    })

    const result = (await app.tools.registered
      .get('grok_imagine_image')!
      .execute({ prompt: 'a cat' }, toolRunContext())) as { workspacePaths?: string[] }

    expect(result.workspacePaths?.[0]).toMatch(new RegExp(`${extension.replace('.', '\\.')}$`, 'u'))

    await app.fiber.dispose()
  })
})

/** Structural stand-in for `ctx.llm`: the plugin only registers and resolves through it. */
class OwnerLlm extends Service {
  readonly registrations: Array<{ routes: readonly string[]; adapter: LlmAdapter }> = []
  readonly registration = Object.assign(vi.fn(), { replace: vi.fn() })
  readonly resolveModelInfo = vi.fn(async (provider: string, model: string) => ({ provider, id: model }))

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  registerAdapter(routes: string[], adapter: LlmAdapter): typeof this.registration {
    this.registrations.push({ routes, adapter })
    return this.registration
  }
}

describe('LLM child composition over a real Cordis context', () => {
  let home: string
  let previousHome: string | undefined

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'avn-llm-child-'))
    previousHome = process.env.AVN_HOME
    process.env.AVN_HOME = home
    await mkdir(join(home, 'workspace'), { recursive: true })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    if (previousHome === undefined) delete process.env.AVN_HOME
    else process.env.AVN_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  })

  async function bootLlm(config: PluginConfig = {}) {
    const subscriptions: OAuthProviderSession[] = []
    vi.spyOn(OAuthProviderSession.prototype, 'loadCachedModels').mockImplementation(async function (
      this: OAuthProviderSession,
    ) {
      subscriptions.push(this)
    })
    const grokSessions: GrokBuildSession[] = []
    vi.spyOn(GrokBuildSession.prototype, 'loadCachedCatalog').mockImplementation(async function (
      this: GrokBuildSession,
    ) {
      grokSessions.push(this)
    })
    vi.spyOn(GrokBuildSession.prototype, 'refreshLiveCatalog').mockResolvedValue(undefined)
    const root = new CordisContext()
    const webServer = new OwnerWebServer(root)
    const tools = new OwnerTools(root)
    const attachments = new OwnerAttachments(root)
    // No Imagine credential: the owner fiber then advertises no Imagine tool,
    // so what this context exposes is exactly what the LLM child contributed.
    new OwnerCredentials(root, undefined)
    new OwnerSandboxPolicy(root, join(home, 'workspace'))
    const llm = new OwnerLlm(root)
    const fiber = root.plugin({ name, inject, apply }, config)
    await fiber
    await vi.waitFor(() => {
      expect(llm.registrations).toHaveLength(1)
    })
    // The Codex image tools are advertised only while a Codex account is signed
    // in, so the composition must prove a credential before it offers them.
    const codex = subscriptions.find(candidate => candidate.definition.slug === 'codex')!
    await codex.store.modify(codex.definition.nativeProviderId, async () => ({
      type: 'oauth',
      access: 'codex-access',
      refresh: 'codex-refresh',
      expires: Date.now() + 3_600_000,
    }))
    codex.notifyCredentialChange()
    await vi.waitFor(() => {
      expect(tools.registered.has('codex_image_generate')).toBe(true)
    })
    return { root, webServer, tools, attachments, llm, subscriptions, grokSessions, fiber }
  }

  it('registers the OAuth adapter and advertises only the Codex image tools beside it', async () => {
    const app = await bootLlm()

    expect(app.llm.registrations[0]!.routes).toEqual([...CODING_OAUTH_ROUTES])
    expect([...app.tools.registered.keys()].sort()).toEqual([CODEX_IMAGE_EDIT_TOOL, CODEX_IMAGE_GENERATE_TOOL])
    // The Imagine tools belong to the owner fiber; this child exposes only the
    // Codex image surface, whose Imagine seam must refuse to run.
    expect(app.tools.registered.has('grok_imagine_image')).toBe(false)

    await app.fiber.dispose()
    expect(app.tools.registered.size).toBe(0)
    expect(app.llm.registration).toHaveBeenCalled()
  })

  it('consults the live Codex Fast flag while listing the Fast route', async () => {
    const disabled = await bootLlm()
    await disabled.llm.registrations[0]!.adapter.listModels(CODEX_OAUTH_FAST_ROUTE)
    await disabled.fiber.dispose()

    const enabled = await bootLlm({ capabilities: { codexFast: true } })
    await enabled.llm.registrations[0]!.adapter.listModels(CODEX_OAUTH_FAST_ROUTE)
    await new Promise(resolve => setTimeout(resolve, 10))
    // Enabling the flag is not enough: the optional Fast route stays withdrawn
    // until a private catalogue refresh confirms an eligible model, and a failed
    // refresh is contained rather than published.
    expect(enabled.llm.registration.replace).not.toHaveBeenCalled()
    await enabled.fiber.dispose()
  })

  it('builds an image-carrying request against the attachment store this composition injected', async () => {
    const app = await bootLlm()
    const grok = app.grokSessions[0]!
    await grok.store.modify(XAI_PI_PROVIDER, async () => SIGNED_IN_GROK)
    const model = grok.visibleModels().find(candidate => candidate.input.includes('image'))!
    const iterator = app.llm.registrations[0]!.adapter
      .stream({
        provider: GROK_BUILD_ROUTE,
        model: model.id,
        messages: [
          {
            id: MessageId('message-1'),
            role: 'user',
            content: [
              {
                type: 'image',
                attachment: {
                  attachmentId: AttachmentId(`sha256:${'ab'.repeat(32)}`),
                  mediaType: 'image/png',
                  bytes: 32,
                  width: 1,
                  height: 1,
                },
              },
            ],
            source: { kind: 'user' },
          },
        ],
      })
      [Symbol.asyncIterator]()

    // The image bytes are resolved through the durable attachment service this
    // composition injected, never through a capture taken at registration time.
    await expect(iterator.next()).rejects.toThrow('serves no request-image payloads')
    expect(app.attachments.imageRequests).toEqual([`sha256:${'ab'.repeat(32)}`])

    await app.fiber.dispose()
  })

  it('resolves the calling route through the LLM registry before a Codex image call', async () => {
    const app = await bootLlm()
    const exec = toolRunContext({
      agent: {
        options: { provider: CODEX_OAUTH_ROUTE, model: 'gpt-5.4' },
        session: {},
      } as unknown as ToolRunContext['agent'],
    })

    await expect(
      app.tools.registered.get(CODEX_IMAGE_GENERATE_TOOL)!.execute({ prompt: 'a cube' }, exec),
    ).rejects.toThrow()
    expect(app.llm.resolveModelInfo).toHaveBeenCalledWith('codex-oauth', 'gpt-5.4', exec.signal)

    await app.fiber.dispose()
  })
})

describe('owner composition runtime seams', () => {
  let home: string
  let previousHome: string | undefined
  let workspaceRoot: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'avn-owner-seams-'))
    previousHome = process.env.AVN_HOME
    process.env.AVN_HOME = home
    workspaceRoot = join(home, 'workspace')
    await mkdir(workspaceRoot, { recursive: true })
    imagineTransport.fetch.mockReset()
    imagineTransport.fetch.mockResolvedValue(
      imagineJsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }] }),
    )
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    if (previousHome === undefined) delete process.env.AVN_HOME
    else process.env.AVN_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  })

  async function bootSeams(
    options: {
      readonly config?: PluginConfig
      readonly apiKey?: string | undefined
      readonly noApiKey?: boolean
      readonly settings?: boolean
      readonly media?: boolean
      readonly sandbox?: boolean
      readonly loadCachedCatalog?: (session: GrokBuildSession) => Promise<void>
      readonly refreshLiveCatalog?: () => Promise<void>
      readonly configure?: (services: {
        credentials: OwnerCredentials
        attachments: OwnerAttachments
        tools: OwnerTools
        settings: OwnerSettings | undefined
      }) => void
    } = {},
  ) {
    const grokSessions: GrokBuildSession[] = []
    const subscriptions: OAuthProviderSession[] = []
    vi.spyOn(OAuthProviderSession.prototype, 'loadCachedModels').mockImplementation(async function (
      this: OAuthProviderSession,
    ) {
      subscriptions.push(this)
    })
    vi.spyOn(GrokBuildSession.prototype, 'loadCachedCatalog').mockImplementation(async function (
      this: GrokBuildSession,
    ) {
      grokSessions.push(this)
      if (options.loadCachedCatalog !== undefined) await options.loadCachedCatalog(this)
    })
    vi.spyOn(GrokBuildSession.prototype, 'refreshLiveCatalog').mockImplementation(
      options.refreshLiveCatalog ?? (async () => undefined),
    )
    const root = new CordisContext()
    const webServer = new OwnerWebServer(root)
    const tools = new OwnerTools(root)
    const attachments = new OwnerAttachments(root)
    const credentials = new OwnerCredentials(
      root,
      options.noApiKey === true ? undefined : (options.apiKey ?? 'xai-api-key'),
    )
    const media = options.media === false ? undefined : new OwnerMedia(root)
    const sandbox = options.sandbox === false ? undefined : new OwnerSandboxPolicy(root, workspaceRoot)
    const settings = options.settings === true ? new OwnerSettings(root) : undefined
    options.configure?.({ credentials, attachments, tools, settings })
    const fiber = root.plugin({ name, inject, apply }, options.config ?? {})
    await fiber
    await vi.waitFor(() => {
      expect(webServer.routes.size).toBeGreaterThan(0)
    })
    return { root, webServer, tools, attachments, credentials, media, sandbox, settings, grokSessions, subscriptions, fiber }
  }

  it('writes a generated image into the workspace when the call carries no agent session', async () => {
    const app = await bootSeams({})
    await vi.waitFor(() => {
      expect(app.tools.registered.has('grok_imagine_image')).toBe(true)
    })

    const result = (await app.tools.registered
      .get('grok_imagine_image')!
      .execute({ prompt: 'a cat' }, toolRunContext({ agent: undefined }))) as { workspacePaths?: string[] }

    expect(result.workspacePaths).toHaveLength(1)

    await app.fiber.dispose()
  })

  it('serves each provider usage answer and retires the token a provider rejects', async () => {
    vi.spyOn(OAuthProviderSession.prototype, 'resolveAccessToken').mockResolvedValue('subscription-token')
    const invalidated = vi.fn()
    vi.spyOn(OAuthProviderSession.prototype, 'invalidateAccessToken').mockImplementation(async () => {
      invalidated()
    })
    vi.spyOn(GrokBuildSession.prototype, 'resolveAccessToken').mockResolvedValue('grok-token')
    vi.spyOn(GrokBuildSession.prototype, 'invalidateAccessToken').mockImplementation(async () => {
      invalidated()
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    const app = await bootSeams({})

    const answered: Record<string, RouteResult> = {}
    for (const slug of ['codex', 'claude', 'grok']) {
      answered[slug] = await app.webServer.request(`${SUBSCRIPTION_USAGE_PATH_PREFIX}${slug}`)
    }

    // A provider that rejects the credential retires it and reads again; the
    // subscription readers report that as data, while the Codex reader surfaces
    // the transport failure.
    expect(invalidated.mock.calls.length).toBeGreaterThanOrEqual(2)
    // Claude is no longer a subscription provider, so its usage path names nothing.
    expect(answered['claude']!.status).toBe(404)
    expect(answered['grok']!.status).toBe(200)
    expect(answered['codex']!.status).toBe(500)
    expect(answered['codex']!.json).toEqual({ error: 'request failed' })

    await app.fiber.dispose()
  })

  it('keeps a failing capability listener from breaking the deployment', async () => {
    const app = await bootSeams({
      noApiKey: true,
      configure: (services) => {
        services.attachments.forcedMediaType = undefined
      },
    })
    const grok = app.grokSessions[0]!
    await grok.store.modify(XAI_PI_PROVIDER, async () => SIGNED_IN_GROK)
    grok.notifyCredentialChange()
    await vi.waitFor(() => {
      expect(app.tools.registered.has('grok_imagine_image')).toBe(true)
    })

    // A registry that throws while a listener reconciles is contained: the
    // change still lands and the deployment keeps serving.
    const register = vi.spyOn(OwnerTools.prototype, 'register')
    register.mockImplementation(function (this: OwnerTools) {
      throw new Error('tool registry is unavailable')
    })
    await grok.logout()
    grok.notifyCredentialChange()
    await grok.store.modify(XAI_PI_PROVIDER, async () => SIGNED_IN_GROK)
    grok.notifyCredentialChange()
    await new Promise(resolve => setTimeout(resolve, 20))
    register.mockRestore()

    expect(app.webServer.routes.has(CODING_OAUTH_STATUS_PATH)).toBe(true)

    await app.fiber.dispose()
  })

  it('contains a media retention failure reported by the runtime', async () => {
    vi.spyOn(MediaStore.prototype, 'applyRetentionMs').mockRejectedValue(new Error('retention sweep failed'))
    const app = await bootSeams({})
    await vi.waitFor(() => {
      expect(app.tools.registered.has('grok_imagine_image')).toBe(true)
    })

    expect(app.webServer.routes.has(CODING_OAUTH_STATUS_PATH)).toBe(true)

    await app.fiber.dispose()
  })

  it('contains a media cleanup failure during disposal', async () => {
    vi.spyOn(MediaStore.prototype, 'cleanup').mockRejectedValue(new Error('media store is unavailable'))
    const app = await bootSeams({})
    await vi.waitFor(() => {
      expect(app.tools.registered.has('grok_imagine_image')).toBe(true)
    })

    await expect(app.fiber.dispose()).resolves.toBeUndefined()
    expect(app.webServer.routes.size).toBe(0)
  })

  it('keeps artifacts under the previous directory name when the move fails', async () => {
    const stateDir = dirname(grokBuildAuthPath())
    const legacy = join(stateDir, LEGACY_IMAGINE_MEDIA_STORE_DIRNAME)
    await mkdir(legacy, { recursive: true })
    await writeFile(join(legacy, 'kept.bin'), 'kept')
    await chmod(stateDir, 0o500)
    try {
      const app = await bootSeams({})
      await vi.waitFor(() => {
        expect(app.tools.registered.has('grok_imagine_image')).toBe(true)
      })

      await expect(readFile(join(legacy, 'kept.bin'), 'utf8')).resolves.toBe('kept')

      await app.fiber.dispose()
    } finally {
      await chmod(stateDir, 0o700)
    }
  })

  it('withholds a late catalog refresh failure that lands after disposal', async () => {
    let rejectRefresh: ((error: Error) => void) | undefined
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      // The startup pass syncs only a signed-in provider, so store the credential first.
      await new GrokBuildCredentialStore().modify(XAI_PI_PROVIDER, async () => SIGNED_IN_GROK)
      const app = await bootSeams({
        refreshLiveCatalog: () =>
          new Promise((_resolve, reject) => {
            rejectRefresh = reject
          }),
      })
      await vi.waitFor(() => {
        expect(rejectRefresh).toBeDefined()
      })

      await app.fiber.dispose()
      rejectRefresh!(new Error('late catalog refresh failed'))
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('ignores a cached catalog load that settles after disposal', async () => {
    let releaseCatalog: (() => void) | undefined
    const refresh = vi.fn(async () => undefined)
    const app = await bootSeams({
      loadCachedCatalog: () =>
        new Promise<void>((resolve) => {
          releaseCatalog = resolve
        }),
      refreshLiveCatalog: refresh,
    })

    await app.fiber.dispose()
    releaseCatalog!()
    await new Promise(resolve => setTimeout(resolve, 20))

    // The late answer is dropped rather than refreshing a catalogue nothing owns.
    expect(refresh).not.toHaveBeenCalled()
    expect(app.webServer.routes.size).toBe(0)
  })

  it('re-injects the capability bridge when a settings provider is replaced', async () => {
    const app = await bootSeams({ settings: false })
    let first: OwnerSettings | undefined
    let second: OwnerSettings | undefined
    const providerA = app.root.plugin((ctx) => {
      first = new OwnerSettings(ctx, {})
    })
    await providerA
    await vi.waitFor(async () => {
      expect((await app.webServer.request(CAPABILITY_SETTINGS_PATH)).status).toBe(200)
    })

    // Withdrawing the provider releases the bridge; mounting a replacement
    // re-injects it, and the stale release must not resurrect the first one.
    const disposal = providerA.dispose()
    const providerB = app.root.plugin((ctx) => {
      second = new OwnerSettings(ctx, { searchResults: 3 })
    })
    await disposal
    await providerB

    const snapshot = await app.webServer.request(CAPABILITY_SETTINGS_PATH)
    expect(snapshot.status).toBe(200)
    expect((snapshot.json as { value: { searchResults: number } }).value.searchResults).toBe(3)
    expect(second!.get()).toEqual({ searchResults: 3 })
    expect(first!.get()).toEqual({})

    await app.fiber.dispose()
    await providerB.dispose()
  })
})

describe('plugin startup invariants', () => {
  it('refuses to start when the built-in OAuth provider roster is incomplete', async () => {
    vi.resetModules()
    vi.doMock('../src/oauth-providers.ts', async importOriginal => ({
      ...(await importOriginal<typeof import('../src/oauth-providers.ts')>()),
      OAUTH_PROVIDER_DEFINITIONS: [],
    }))
    try {
      const mod = await import('../src/index.ts')
      const root = new CordisContext()
      const webServer = new OwnerWebServer(root)
      const tools = new OwnerTools(root)
      new OwnerAttachments(root)
      new OwnerCredentials(root, 'xai-api-key')
      new OwnerMedia(root)
      new OwnerSandboxPolicy(root, join(tmpdir(), 'avn-roster-guard'))
      const fiber = root.plugin({ name: mod.name, inject: mod.inject, apply: mod.apply })
      await fiber
      await new Promise(resolve => setTimeout(resolve, 20))

      // The activation refuses to half-mount: with a provider the runtime cannot
      // name, no owner route is served and no capability is advertised.
      expect(webServer.routes.size).toBe(0)
      expect(tools.registered.size).toBe(0)
    } finally {
      vi.doUnmock('../src/oauth-providers.ts')
      vi.resetModules()
    }
  })

  it('publishes the plugin contract as named exports', async () => {
    const mod = (await import('../src/index.ts')) as Record<string, unknown>
    expect(name).toBe('llm-grok-build-oauth')
    expect(inject).toEqual(['webServer'])
    expect('default' in mod).toBe(false)
  })
})
