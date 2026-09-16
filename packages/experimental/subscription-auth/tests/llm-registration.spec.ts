import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLAUDE_CODE_OAUTH_ROUTE,
  CODEX_OAUTH_ROUTE,
  CODING_OAUTH_ROUTES,
  GROK_BUILD_ROUTE,
  XAI_PI_PROVIDER,
} from '../src/ids.ts'
import { apply, inject, name } from '../src/index.ts'
import { OAuthProviderSession } from '../src/oauth-session.ts'
import { GrokBuildSession } from '../src/session.ts'

class TestWebServer extends Service {
  constructor(ctx: Context) {
    super(ctx, 'webServer')
  }

  register(): () => void {
    return () => undefined
  }
}

let home: string
let previousHome: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-llm-registration-'))
  previousHome = process.env.AVN_HOME
  // Every session's credential and model-cache files resolve below AVN_HOME.
  process.env.AVN_HOME = home
})

afterEach(async () => {
  vi.restoreAllMocks()
  if (previousHome === undefined) delete process.env.AVN_HOME
  else process.env.AVN_HOME = previousHome
  await rm(home, { recursive: true, force: true })
})

/** Boot the plugin beside the real LLM registry and capture the sessions it owns. */
async function boot(): Promise<{
  root: Context
  llm: LlmRuntime
  grok: GrokBuildSession
  subscriptions: OAuthProviderSession[]
  updates: () => number
  dispose: () => Promise<void>
}> {
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
  // No network: the live listing is covered by catalog/session specs.
  vi.spyOn(GrokBuildSession.prototype, 'refreshLiveCatalog').mockResolvedValue(undefined)
  const root = new Context()
  root.plugin(LlmRuntime)
  root.plugin((ctx) => {
    new TestWebServer(ctx)
  })
  let updates = 0
  root.on('llm/adapters-updated', () => {
    updates++
  })
  const fiber = root.plugin({ name, inject, apply })
  await fiber
  await vi.waitFor(() => {
    expect(grokSessions).toHaveLength(1)
    expect(subscriptions).toHaveLength(2)
  })
  return {
    root,
    llm: root.get('llm') as LlmRuntime,
    grok: grokSessions[0]!,
    subscriptions,
    updates: () => updates,
    dispose: () => fiber.dispose(),
  }
}

const SIGNED_IN = { type: 'oauth', access: 'access', refresh: 'refresh', expires: Date.now() + 3_600_000 } as const

describe('OAuth LLM route registration', () => {
  it('registers every served subscription route with the real LLM registry', async () => {
    const app = await boot()
    await vi.waitFor(() => {
      expect(app.llm.listProviders().map(provider => provider.id)).toEqual([...CODING_OAUTH_ROUTES])
    })
    for (const route of CODING_OAUTH_ROUTES) expect(await app.llm.listModels(route)).toEqual([])
    await app.dispose()
    expect(app.llm.listProviders()).toEqual([])
  })

  it.each([
    ['codex', CODEX_OAUTH_ROUTE],
    ['claude', CLAUDE_CODE_OAUTH_ROUTE],
  ] as const)('publishes the %s catalog once its sign-in lands', async (slug, route) => {
    const app = await boot()
    await vi.waitFor(() => {
      expect(app.llm.listProviders().map(provider => provider.id)).toContain(route)
    })
    const session = app.subscriptions.find(candidate => candidate.definition.slug === slug)!
    await session.store.modify(session.definition.nativeProviderId, async () => SIGNED_IN)
    const before = app.updates()
    session.notifyCredentialChange()
    expect(app.updates()).toBeGreaterThan(before)
    const models = await app.llm.listModels(route)
    expect(models.length).toBeGreaterThan(0)
    expect(models.map(model => model.id)).toEqual(session.visibleModels().map(model => model.id))
    await app.dispose()
  })

  it('publishes the Grok Build catalog once its sign-in lands', async () => {
    const app = await boot()
    await vi.waitFor(() => {
      expect(app.llm.listProviders().map(provider => provider.id)).toContain(GROK_BUILD_ROUTE)
    })
    await app.grok.store.modify(XAI_PI_PROVIDER, async () => SIGNED_IN)
    const before = app.updates()
    app.grok.notifyCredentialChange()
    expect(app.updates()).toBeGreaterThan(before)
    const models = await app.llm.listModels(GROK_BUILD_ROUTE)
    expect(models.map(model => model.id)).toEqual(app.grok.visibleModels().map(model => model.id))
    expect(models.length).toBeGreaterThan(0)
    await app.dispose()
  })
})
