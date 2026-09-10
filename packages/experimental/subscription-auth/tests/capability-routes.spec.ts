import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_SETTINGS_PATH,
  type CapabilityRouteController,
  CODEX_USAGE_PATH,
  IMAGINE_CREDENTIAL_STATUS_PATH,
  registerCapabilityRoutes,
  SUBSCRIPTION_USAGE_PATH_PREFIX,
  SUBSCRIPTION_USAGE_ROUTE,
} from '../src/capability-routes.ts'
import {
  CAPABILITY_SETTINGS_NAMESPACE,
  type CapabilitySettings,
  CapabilitySettingsConflictError,
  type CapabilitySettingsPatch,
  CapabilitySettingsReadOnlyError,
  type CapabilitySettingsSnapshot,
  DEFAULT_CAPABILITY_SETTINGS,
} from '../src/capability-settings.ts'
import { JSON_BODY_LIMIT_BYTES } from '../src/http-json.ts'

/** A prefix-routed usage request; the handler reads the slug off `url`. */
function usageRequest(slug: string, query = ''): IncomingMessage {
  const stream = request('GET')
  Object.defineProperty(stream, 'url', { value: `${SUBSCRIPTION_USAGE_PATH_PREFIX}${slug}${query}`, configurable: true })
  return stream
}

/** A request with an explicit `url`, for the routes that parse it themselves. */
function urlRequest(
  url: string | undefined,
  method = 'GET',
  headers: IncomingMessage['headers'] = {},
): IncomingMessage {
  const stream = request(method, '', headers)
  Object.defineProperty(stream, 'url', { value: url, configurable: true })
  return stream
}

/** A request that carries no HTTP method at all. */
function methodlessRequest(): IncomingMessage {
  const stream = request('GET')
  Object.defineProperty(stream, 'method', { value: undefined, configurable: true })
  return stream
}

interface RegisteredRoute {
  path: string
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
}

class TestResponse {
  status = 0
  body = ''

  writeHead(status: number): this {
    this.status = status
    return this
  }

  end(value?: string): this {
    this.body += value ?? ''
    return this
  }
}

class FakeController implements CapabilityRouteController {
  revision = 0
  writable = true
  readOnlyReason: 'absent' | 'read-only' | 'disposed' | undefined
  value: CapabilitySettings = { ...DEFAULT_CAPABILITY_SETTINGS }
  user: CapabilitySettingsPatch = {}
  writes: Array<{ mode: 'patch' | 'replace'; payload: CapabilitySettingsPatch; expectedRevision: number }> = []

  snapshot(): CapabilitySettingsSnapshot {
    return {
      ns: CAPABILITY_SETTINGS_NAMESPACE,
      value: this.value,
      revision: this.revision,
      writable: this.writable,
      applies: 'live',
      secrets: [],
      ...(Object.keys(this.user).length > 0 ? { user: this.user } : {}),
    }
  }

  async patch(patch: CapabilitySettingsPatch, expectedRevision: number): Promise<CapabilitySettingsSnapshot> {
    this.writes.push({ mode: 'patch', payload: patch, expectedRevision })
    this.assertWrite(expectedRevision)
    this.user = { ...this.user, ...patch }
    this.value = { ...this.value, ...patch }
    this.revision += 1
    return this.snapshot()
  }

  async replace(section: CapabilitySettingsPatch, expectedRevision: number): Promise<CapabilitySettingsSnapshot> {
    this.writes.push({ mode: 'replace', payload: section, expectedRevision })
    this.assertWrite(expectedRevision)
    this.user = { ...section }
    this.value = { ...DEFAULT_CAPABILITY_SETTINGS, ...section }
    this.revision += 1
    return this.snapshot()
  }

  private assertWrite(expectedRevision: number): void {
    if (this.readOnlyReason !== undefined) throw new CapabilitySettingsReadOnlyError(this.readOnlyReason)
    if (expectedRevision !== this.revision) {
      throw new CapabilitySettingsConflictError(expectedRevision, this.revision)
    }
  }
}

function request(
  method: string,
  body = '',
  headers: IncomingMessage['headers'] = {},
  remoteAddress = '127.0.0.1',
): IncomingMessage {
  const stream = Readable.from([body]) as unknown as IncomingMessage
  Object.defineProperties(stream, {
    method: { value: method, configurable: true },
    headers: {
      value: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', ...headers },
      configurable: true,
    },
    socket: { value: { remoteAddress }, configurable: true },
  })
  return stream
}

function createHarness(options?: {
  controller?: FakeController
  usage?: (readOptions?: { force?: boolean }) => unknown
  credentialInfo?: () => unknown
  failOnPath?: string
  routes?: Map<string, RegisteredRoute['handler']>
}): {
  controller: FakeController
  routes: Map<string, RegisteredRoute['handler']>
  dispose: () => void
} {
  const controller = options?.controller ?? new FakeController()
  const routes = options?.routes ?? new Map<string, RegisteredRoute['handler']>()
  const dispose = registerCapabilityRoutes(
    {
      webServer: {
        register(route: RegisteredRoute) {
          if (options?.failOnPath !== undefined && route.path === options.failOnPath) {
            throw new Error(`webserver: duplicate exact route "${route.path}"`)
          }
          routes.set(route.path, route.handler)
          return () => {
            routes.delete(route.path)
          }
        },
      },
      effect(setup) {
        return setup()
      },
    },
    {
      controller,
      ...(options?.usage === undefined ? {} : { usageReaders: { codex: { read: async readOptions => options.usage?.(readOptions) } } }),
      ...(options?.credentialInfo === undefined ? {} : { credentialInfo: options.credentialInfo }),
    },
  )
  return { controller, routes, dispose }
}

async function invoke(
  handler: RegisteredRoute['handler'] | undefined,
  req: IncomingMessage,
): Promise<{ status: number; body: unknown }> {
  if (handler === undefined) throw new Error('route was not registered')
  const response = new TestResponse()
  await handler(req, response as unknown as ServerResponse)
  return { status: response.status, body: response.body.length === 0 ? undefined : JSON.parse(response.body) }
}

describe('capability route registrar', () => {
  it('registers the capabilities path and owns the route disposer', async () => {
    const { routes, dispose } = createHarness()
    expect([...routes.keys()]).toEqual([CAPABILITY_SETTINGS_PATH])
    const listed = await invoke(routes.get(CAPABILITY_SETTINGS_PATH), request('GET'))
    expect(listed.status).toBe(200)
    dispose()
    expect(routes.size).toBe(0)
  })

  it('registers optional usage and credential-status routes only when injected', () => {
    const bare = createHarness()
    expect(bare.routes.has(CODEX_USAGE_PATH)).toBe(false)
    expect(bare.routes.has(IMAGINE_CREDENTIAL_STATUS_PATH)).toBe(false)

    const full = createHarness({
      usage: () => ({ remaining: 1 }),
      credentialInfo: () => ({ configured: false, source: 'none', writable: false }),
    })
    expect(full.routes.has(CODEX_USAGE_PATH)).toBe(true)
    expect(full.routes.has(IMAGINE_CREDENTIAL_STATUS_PATH)).toBe(true)
  })

  it('rolls back the capabilities route when the usage route fails to register', () => {
    const routes = new Map<string, RegisteredRoute['handler']>()
    expect(() =>
      createHarness({
        routes,
        usage: () => ({ remaining: 1 }),
        credentialInfo: () => ({ configured: false, source: 'none', writable: false }),
        failOnPath: CODEX_USAGE_PATH,
      }),
    ).toThrow(`webserver: duplicate exact route "${CODEX_USAGE_PATH}"`)
    expect(routes.size).toBe(0)
    expect(routes.has(CAPABILITY_SETTINGS_PATH)).toBe(false)
  })

  it('rolls back earlier capability routes when the credential-status route fails', () => {
    const routes = new Map<string, RegisteredRoute['handler']>()
    expect(() =>
      createHarness({
        routes,
        usage: () => ({ remaining: 1 }),
        credentialInfo: () => ({ configured: false, source: 'none', writable: false }),
        failOnPath: IMAGINE_CREDENTIAL_STATUS_PATH,
      }),
    ).toThrow(`webserver: duplicate exact route "${IMAGINE_CREDENTIAL_STATUS_PATH}"`)
    expect(routes.size).toBe(0)
    expect(routes.has(CAPABILITY_SETTINGS_PATH)).toBe(false)
    expect(routes.has(CODEX_USAGE_PATH)).toBe(false)
  })
})

describe('GET /plugins/dsh-grok-build/capabilities', () => {
  it('returns the default-off secret-free snapshot', async () => {
    const { routes } = createHarness()
    const response = await invoke(routes.get(CAPABILITY_SETTINGS_PATH), request('GET'))
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      ns: CAPABILITY_SETTINGS_NAMESPACE,
      value: DEFAULT_CAPABILITY_SETTINGS,
      revision: 0,
      writable: true,
      applies: 'live',
      secrets: [],
    })
    const snapshot = response.body as CapabilitySettingsSnapshot
    expect(snapshot.value.codexSearch).toBe(false)
    expect(snapshot.value.codexFast).toBe(false)
    // Media generation is fixed on rather than default-off.
    expect(snapshot.value.codexImages).toBe(true)
    expect(snapshot.value.grokImagineImage).toBe(true)
    expect(snapshot.value.grokImagineVideo).toBe(true)
    expect(snapshot.secrets).toEqual([])
    expect(response.body).not.toHaveProperty('apiKey')
    expect(JSON.stringify(snapshot.value)).not.toMatch(/apiKey|access_token|password/iu)
  })
})

describe('PATCH/PUT compare-and-swap', () => {
  it('patches then replaces through expectedRevision and refuses a stale write', async () => {
    const { controller, routes } = createHarness()
    const handler = routes.get(CAPABILITY_SETTINGS_PATH)

    const patched = await invoke(
      handler,
      request('PATCH', JSON.stringify({ expectedRevision: 0, patch: { codexSearch: true, searchResults: 3 } })),
    )
    expect(patched.status).toBe(200)
    expect(patched.body).toMatchObject({
      revision: 1,
      value: { ...DEFAULT_CAPABILITY_SETTINGS, codexSearch: true, searchResults: 3 },
      user: { codexSearch: true, searchResults: 3 },
      secrets: [],
    })
    expect(controller.writes).toEqual([
      { mode: 'patch', payload: { codexSearch: true, searchResults: 3 }, expectedRevision: 0 },
    ])

    const replaced = await invoke(handler, request('PUT', JSON.stringify({ expectedRevision: 1, value: {} })))
    expect(replaced.status).toBe(200)
    expect(replaced.body).toMatchObject({
      revision: 2,
      value: DEFAULT_CAPABILITY_SETTINGS,
      secrets: [],
    })
    expect((replaced.body as CapabilitySettingsSnapshot).user).toBeUndefined()

    const stale = await invoke(
      handler,
      request('PATCH', JSON.stringify({ expectedRevision: 1, patch: { codexFast: true } })),
    )
    expect(stale.status).toBe(409)
    expect(stale.body).toEqual({
      error: expect.stringContaining('expected revision 1') as string,
      code: 'SETTINGS_CONFLICT',
      expected: 1,
      actual: 2,
    })
    expect(controller.value.codexFast).toBe(false)
  })

  it('maps absent/disposed writes to 503 and a read-only provider to 403', async () => {
    const absent = new FakeController()
    absent.readOnlyReason = 'absent'
    const absentRoutes = createHarness({ controller: absent }).routes
    const missing = await invoke(
      absentRoutes.get(CAPABILITY_SETTINGS_PATH),
      request('PATCH', JSON.stringify({ expectedRevision: 0, patch: { codexFast: true } })),
    )
    expect(missing.status).toBe(503)
    expect(missing.body).toMatchObject({ code: 'SETTINGS_PROVIDER_ABSENT' })

    const disposed = new FakeController()
    disposed.readOnlyReason = 'disposed'
    const disposedRoutes = createHarness({ controller: disposed }).routes
    const gone = await invoke(
      disposedRoutes.get(CAPABILITY_SETTINGS_PATH),
      request('PATCH', JSON.stringify({ expectedRevision: 0, patch: { codexFast: true } })),
    )
    expect(gone.status).toBe(503)
    expect(gone.body).toMatchObject({ code: 'SETTINGS_DISPOSED' })

    const locked = new FakeController()
    locked.readOnlyReason = 'read-only'
    const lockedRoutes = createHarness({ controller: locked }).routes
    const forbidden = await invoke(
      lockedRoutes.get(CAPABILITY_SETTINGS_PATH),
      request('PUT', JSON.stringify({ expectedRevision: 0, value: { searchResults: 2 } })),
    )
    expect(forbidden.status).toBe(403)
    expect(forbidden.body).toMatchObject({ code: 'SETTINGS_READ_ONLY' })
  })
})

describe('capability route validation', () => {
  it('rejects unknown and secret-shaped keys before calling the controller', async () => {
    const { controller, routes } = createHarness()
    const handler = routes.get(CAPABILITY_SETTINGS_PATH)

    const unknown = await invoke(
      handler,
      request('PATCH', JSON.stringify({ expectedRevision: 0, patch: { extra: true, codexSearch: true } })),
    )
    expect(unknown.status).toBe(400)
    expect(unknown.body).toEqual({ error: 'patch contains unknown key extra' })

    const secret = await invoke(
      handler,
      request(
        'PUT',
        JSON.stringify({
          expectedRevision: 0,
          value: { apiKey: 'sk-secret', access_token: 'tok', codexImages: true },
        }),
      ),
    )
    expect(secret.status).toBe(400)
    expect((secret.body as { error: string }).error).toMatch(/secret-free \(rejected key apiKey\)/)
    expect(controller.writes).toEqual([])
    expect(JSON.stringify(secret.body)).not.toContain('sk-secret')
  })

  it('rejects invalid types, fractional limits, and out-of-range limits', async () => {
    const { controller, routes } = createHarness()
    const handler = routes.get(CAPABILITY_SETTINGS_PATH)
    for (const patch of [
      { codexSearch: 'true' },
      { searchResults: 1.5 },
      { searchResults: 21 },
      // Retired settings are unknown keys now, and a write naming one is refused.
      { imageCount: 4 },
      { grokImagineImage: true },
    ]) {
      const response = await invoke(handler, request('PATCH', JSON.stringify({ expectedRevision: 0, patch })))
      expect(response.status).toBe(400)
    }
    expect(controller.writes).toEqual([])
  })

  it('rejects invalid envelopes and oversized JSON bodies', async () => {
    const { routes } = createHarness()
    const handler = routes.get(CAPABILITY_SETTINGS_PATH)

    const malformed = await invoke(handler, request('PATCH', '{not-json'))
    expect(malformed.status).toBe(400)
    expect(malformed.body).toEqual({ error: 'request body must contain valid JSON' })

    const missing = await invoke(handler, request('PATCH', JSON.stringify({ patch: { codexSearch: true } })))
    expect(missing.status).toBe(400)
    expect(missing.body).toEqual({ error: 'expectedRevision must be a nonnegative integer' })

    const negative = await invoke(
      handler,
      request('PUT', JSON.stringify({ expectedRevision: -1, value: { searchResults: 2 } })),
    )
    expect(negative.status).toBe(400)

    const oversized = await invoke(
      handler,
      request('PATCH', '', { 'content-length': String(JSON_BODY_LIMIT_BYTES + 1) }),
    )
    expect(oversized.status).toBe(413)
    expect(oversized.body).toEqual({ error: 'request body is too large' })
  })
})

describe('same-origin trust checks', () => {
  it('rejects non-loopback, cross-site, and Origin/Host mismatch before reading the body', async () => {
    const { controller, routes } = createHarness()
    const handler = routes.get(CAPABILITY_SETTINGS_PATH)
    const payload = JSON.stringify({ expectedRevision: 0, patch: { codexSearch: true } })

    const remote = await invoke(handler, request('PATCH', payload, {}, '10.0.0.8'))
    expect(remote.status).toBe(403)

    const crossSite = await invoke(handler, request('PATCH', payload, { 'sec-fetch-site': 'cross-site' }))
    expect(crossSite.status).toBe(403)

    const mismatched = await invoke(handler, request('PATCH', payload, { origin: 'https://evil.example' }))
    expect(mismatched.status).toBe(403)

    expect(controller.writes).toEqual([])
  })
})

describe('optional capability read surfaces', () => {
  it('serves usage with no capability flag set, because usage is not a toggle', async () => {
    let called = 0
    const { routes } = createHarness({
      usage: () => {
        called += 1
        return { remaining: 9 }
      },
    })
    const response = await invoke(routes.get(CODEX_USAGE_PATH), request('GET'))
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ remaining: 9 })
    expect(called).toBe(1)
  })

  it('serves the per-provider path and 404s a provider with no reader', async () => {
    const { routes } = createHarness({ usage: () => ({ remaining: 9 }) })
    const handler = routes.get(SUBSCRIPTION_USAGE_ROUTE)

    const served = await invoke(handler, usageRequest('codex'))
    expect(served.status).toBe(200)
    expect(served.body).toEqual({ remaining: 9 })

    const missing = await invoke(handler, usageRequest('kimi'))
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: 'unknown usage provider' })
  })

  it('re-reads the provider only when the viewer asks for a refresh', async () => {
    const reads: (boolean | undefined)[] = []
    const { routes } = createHarness({
      usage: (readOptions) => {
        reads.push(readOptions?.force)
        return { remaining: 1 }
      },
    })
    const handler = routes.get(SUBSCRIPTION_USAGE_ROUTE)

    await invoke(handler, usageRequest('codex'))
    await invoke(handler, usageRequest('codex', '?refresh=1'))
    expect(reads).toEqual([false, true])
  })

  it('redacts internal 500 diagnostics from optional read surfaces', async () => {
    const { routes } = createHarness({
      usage: () => {
        throw new Error('failed reading /home/private/oauth.json with token secret')
      },
    })
    const response = await invoke(routes.get(CODEX_USAGE_PATH), request('GET'))
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: 'request failed' })
  })

  it('delegates usage and never returns secret values', async () => {
    const { routes } = createHarness({
      usage: () => ({ plan: 'plus', remaining: 4, resetAt: 1 }),
      credentialInfo: () => ({
        configured: true,
        source: 'file',
        writable: false,
        apiKey: 'sk-secret',
        access_token: 'tok',
        credential: 'leak',
      }),
    })

    const usage = await invoke(routes.get(CODEX_USAGE_PATH), request('GET'))
    expect(usage.status).toBe(200)
    expect(usage.body).toEqual({ plan: 'plus', remaining: 4, resetAt: 1 })
    expect(JSON.stringify(usage.body)).not.toMatch(/apiKey|access_token|sk-/u)

    const status = await invoke(routes.get(IMAGINE_CREDENTIAL_STATUS_PATH), request('GET'))
    expect(status.status).toBe(200)
    expect(status.body).toEqual({ configured: true, source: 'file', writable: false })
    expect(status.body).not.toHaveProperty('apiKey')
    expect(status.body).not.toHaveProperty('access_token')
    expect(status.body).not.toHaveProperty('credential')
  })

  it('redacts unbounded or path-shaped credential source labels', async () => {
    const { routes } = createHarness({
      credentialInfo: () => ({ configured: true, source: '/home/private/XAI_API_KEY', writable: true }),
    })
    const status = await invoke(routes.get(IMAGINE_CREDENTIAL_STATUS_PATH), request('GET'))
    expect(status.body).toEqual({ configured: true, source: 'unknown', writable: true })
  })
})

describe('capability route registrar ownership', () => {
  it('returns a safe no-op disposer until the owning effect runs', () => {
    const routes = new Map<string, RegisteredRoute['handler']>()
    const setups: Array<() => () => void | Promise<void>> = []
    const dispose = registerCapabilityRoutes(
      {
        webServer: {
          register(route: RegisteredRoute) {
            routes.set(route.path, route.handler)
            return () => {
              routes.delete(route.path)
            }
          },
        },
        effect(setup) {
          setups.push(setup)
          return undefined
        },
      },
      { controller: new FakeController() },
    )

    expect(setups).toHaveLength(1)
    expect(routes.size).toBe(0)
    expect(() => {
      dispose()
    }).not.toThrow()
    expect(routes.size).toBe(0)
  })
})

describe('capability settings method guards', () => {
  it('answers 405 for a method the capabilities route does not serve', async () => {
    const { routes } = createHarness()
    const handler = routes.get(CAPABILITY_SETTINGS_PATH)

    const methodless = await invoke(handler, methodlessRequest())
    expect(methodless.status).toBe(405)
    expect(methodless.body).toEqual({ error: 'method not allowed' })

    const deleted = await invoke(handler, request('DELETE'))
    expect(deleted.status).toBe(405)
    expect(deleted.body).toEqual({ error: 'method not allowed' })
  })
})

describe('capability settings write envelope validation', () => {
  it('refuses a non-object envelope and a non-object payload', async () => {
    const { controller, routes } = createHarness()
    const handler = routes.get(CAPABILITY_SETTINGS_PATH)

    const notAnObject = await invoke(handler, request('PATCH', JSON.stringify([{ expectedRevision: 0 }])))
    expect(notAnObject.status).toBe(400)
    expect(notAnObject.body).toEqual({ error: 'request body must be a JSON object' })

    const arrayPayload = await invoke(handler, request('PATCH', JSON.stringify({ expectedRevision: 0, patch: [] })))
    expect(arrayPayload.status).toBe(400)
    expect(arrayPayload.body).toEqual({ error: 'patch must be a JSON object' })

    const scalarValue = await invoke(handler, request('PUT', JSON.stringify({ expectedRevision: 0, value: 'yes' })))
    expect(scalarValue.status).toBe(400)
    expect(scalarValue.body).toEqual({ error: 'value must be a JSON object' })

    expect(controller.writes).toEqual([])
  })
})

describe('capability route error mapping', () => {
  /** Drive a write route through a controller whose write fails with `thrown`. */
  async function writeWith(thrown: unknown): Promise<{ status: number; body: unknown }> {
    const controller = new FakeController()
    controller.patch = async () => {
      throw thrown
    }
    const { routes } = createHarness({ controller })
    return invoke(
      routes.get(CAPABILITY_SETTINGS_PATH),
      request('PATCH', JSON.stringify({ expectedRevision: 0, patch: { codexSearch: true } })),
    )
  }

  it('answers 403 when a foreign error claims the provider is read-only', async () => {
    const foreign = Object.assign(new Error('provider is read-only'), { code: 'SETTINGS_READ_ONLY' })
    const response = await writeWith(foreign)
    expect(response.status).toBe(403)
    expect(response.body).toEqual({ error: 'provider is read-only' })
  })

  it('answers 503 when a foreign error claims the provider is absent or disposed', async () => {
    for (const code of ['SETTINGS_PROVIDER_ABSENT', 'SETTINGS_DISPOSED'] as const) {
      const response = await writeWith(Object.assign(new Error(`provider is ${code}`), { code }))
      expect(response.status).toBe(503)
      expect(response.body).toEqual({ error: 'request failed' })
    }
  })

  it('answers 400 for a TypeError from the controller and 500 for anything else', async () => {
    const typed = await writeWith(new TypeError('searchResults must be an integer'))
    expect(typed.status).toBe(400)
    expect(typed.body).toEqual({ error: 'searchResults must be an integer' })

    const opaque = await writeWith('provider offline')
    expect(opaque.status).toBe(500)
    expect(opaque.body).toEqual({ error: 'request failed' })
  })

  it('maps a conflict-shaped error and refuses a half-formed one', async () => {
    const conflict = await writeWith(
      Object.assign(new Error('namespace moved'), { code: 'SETTINGS_CONFLICT', expected: 3, actual: 7 }),
    )
    expect(conflict.status).toBe(409)
    expect(conflict.body).toEqual({
      error: 'namespace moved',
      code: 'SETTINGS_CONFLICT',
      expected: 3,
      actual: 7,
    })

    for (const half of [{ code: 'SETTINGS_CONFLICT' }, { code: 'SETTINGS_CONFLICT', expected: 3 }]) {
      const response = await writeWith(half)
      expect(response.status).toBe(500)
      expect(response.body).toEqual({ error: 'request failed' })
    }
  })
})

describe('usage route path guards', () => {
  it('answers 404 for a usage request with no usable provider path', async () => {
    const { routes } = createHarness({ usage: () => ({ remaining: 1 }) })
    const handler = routes.get(SUBSCRIPTION_USAGE_ROUTE)

    const noUrl = await invoke(handler, urlRequest(undefined))
    expect(noUrl.status).toBe(404)
    expect(noUrl.body).toEqual({ error: 'unknown usage provider' })

    const notUsage = await invoke(handler, urlRequest('/plugins/other/usage/codex'))
    expect(notUsage.status).toBe(404)
    expect(notUsage.body).toEqual({ error: 'unknown usage provider' })

    const badSlug = await invoke(handler, usageRequest('Codex!'))
    expect(badSlug.status).toBe(404)
    expect(badSlug.body).toEqual({ error: 'unknown usage provider' })
  })
})

describe('optional read surface guards', () => {
  it('answers 405 for a non-GET usage or credential-status request', async () => {
    const { routes } = createHarness({ usage: () => ({ remaining: 1 }), credentialInfo: () => ({}) })

    const prefixed = await invoke(
      routes.get(SUBSCRIPTION_USAGE_ROUTE),
      urlRequest(`${SUBSCRIPTION_USAGE_PATH_PREFIX}codex`, 'POST'),
    )
    expect(prefixed.status).toBe(405)
    expect(prefixed.body).toEqual({ error: 'method not allowed' })

    const legacy = await invoke(routes.get(CODEX_USAGE_PATH), request('POST'))
    expect(legacy.status).toBe(405)
    expect(legacy.body).toEqual({ error: 'method not allowed' })

    const credential = await invoke(routes.get(IMAGINE_CREDENTIAL_STATUS_PATH), request('POST'))
    expect(credential.status).toBe(405)
    expect(credential.body).toEqual({ error: 'method not allowed' })
  })

  it('refuses a cross-site usage or credential-status read', async () => {
    const { routes } = createHarness({ usage: () => ({ remaining: 1 }), credentialInfo: () => ({}) })
    const crossSite = { 'sec-fetch-site': 'cross-site' }

    const prefixed = await invoke(
      routes.get(SUBSCRIPTION_USAGE_ROUTE),
      urlRequest(`${SUBSCRIPTION_USAGE_PATH_PREFIX}codex`, 'GET', crossSite),
    )
    expect(prefixed.status).toBe(403)
    expect(prefixed.body).toEqual({ error: 'forbidden' })

    const legacy = await invoke(routes.get(CODEX_USAGE_PATH), request('GET', '', crossSite))
    expect(legacy.status).toBe(403)
    expect(legacy.body).toEqual({ error: 'forbidden' })

    const credential = await invoke(routes.get(IMAGINE_CREDENTIAL_STATUS_PATH), request('GET', '', crossSite))
    expect(credential.status).toBe(403)
    expect(credential.body).toEqual({ error: 'forbidden' })
  })

  it('redacts a failing credential probe instead of leaking its detail', async () => {
    const { routes } = createHarness({
      credentialInfo: () => {
        throw new Error('probe failed reading /home/private/xai.json')
      },
    })
    const response = await invoke(routes.get(IMAGINE_CREDENTIAL_STATUS_PATH), request('GET'))
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: 'request failed' })
  })
})

describe('Imagine credential status projection', () => {
  it('falls back to an unknown projection when the probe returns a non-object', async () => {
    const { routes } = createHarness({ credentialInfo: () => 42 })
    const response = await invoke(routes.get(IMAGINE_CREDENTIAL_STATUS_PATH), request('GET'))
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ configured: false, source: 'unknown', writable: false })
  })

  it('projects a prototype-less probe result instead of discarding it', async () => {
    const info = Object.assign(Object.create(null) as Record<string, unknown>, {
      configured: true,
      source: 'file',
      writable: true,
    })
    const { routes } = createHarness({ credentialInfo: () => info })
    const response = await invoke(routes.get(IMAGINE_CREDENTIAL_STATUS_PATH), request('GET'))
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ configured: true, source: 'file', writable: true })
  })
})
