/**
 * REAL-composition guard for the live catalog refresh: LlmRuntime, settings-
 * file, and an `llm-pi-ai` row boot from a test-only cordis.yml through the
 * actual Loader + Include path, with a route whose `catalogRefresh` points at
 * a local model document. The assertions observe the models the route
 * actually serves — a hand-mounted `ctx.plugin` would not exercise the
 * settings-driven profile the refresh reads its endpoint from.
 */

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@aeven/llm'
import FileSettingsProvider from '@aeven/settings-file'
import * as LlmPiAi from '@aeven/llm-pi-ai'
import { catalogModels } from '../src/catalog.ts'

let root: string | undefined
let context: Context | undefined
const servers: Server[] = []

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await Promise.all(servers.splice(0).map(server => new Promise((resolve) => { server.close(resolve) })))
  vi.unstubAllEnvs()
})

/** The one model the document publishes that the installed snapshot does not describe. */
const ADDED_ID = 'acme/live-only-model'

/**
 * Serve one model document over HTTP.
 * @param behavior - status, body, and an optional delay before responding.
 * @returns the listening origin.
 */
async function documentServer(behavior: { status?: number; body: string; delayMs?: number }): Promise<string> {
  const server = createServer((_request, response) => {
    const send = (): void => {
      response.writeHead(behavior.status ?? 200, { 'content-type': 'application/json' })
      response.end(behavior.body)
    }
    if (behavior.delayMs === undefined) send()
    else setTimeout(send, behavior.delayMs)
  })
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return `http://127.0.0.1:${String(address.port)}`
}

/** A document publishing one model the snapshot lacks. */
const DOCUMENT = JSON.stringify({
  data: [{
    id: ADDED_ID,
    name: 'Acme Live Only',
    context_length: 65_536,
    architecture: { input_modalities: ['text'] },
    top_provider: { context_length: 65_536, max_completion_tokens: 4096 },
    supported_parameters: ['tools'],
  }],
})

/**
 * Boot the composition with one refreshing route.
 * @param url - the model document endpoint the route configures.
 * @param route - route key to configure; defaults to the openrouter catalog.
 * @param extra - further profile lines, already indented six spaces.
 * @returns the booted root context.
 */
async function loadComposition(url: string, route = 'openrouter', extra: string[] = []): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'avn-pi-live-catalog-'))
  const settingsPath = join(root, 'settings.yaml')
  await writeFile(settingsPath, [
    'llm-pi-ai:',
    '  providers:',
    `    ${route}:`,
    '      apiKeyEnv: LIVE_CATALOG_KEY',
    ...route === 'openrouter' ? ['      api: openai-completions'] : [],
    ...extra,
    '      catalogRefresh:',
    `        url: ${url}`,
    '',
  ].join('\n'))

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    '- id: settings',
    "  name: '@aeven/settings-file'",
    '  config:',
    `    path: ${JSON.stringify(settingsPath)}`,
    '    debounceMs: 10',
    '- id: llm-pi-ai',
    "  name: '@aeven/llm-pi-ai'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@aeven/settings-file', FileSettingsProvider],
    ['@aeven/llm-pi-ai', LlmPiAi],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

/** Model ids the route serves, once the refresh settles. */
async function servedIds(ctx: Context): Promise<string[]> {
  // The refresh runs as an effect, so the first resolution can precede it.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const models = await ctx.llm.listModels('openrouter')
    if (models.some(model => model.id === ADDED_ID)) return models.map(model => model.id)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return (await ctx.llm.listModels('openrouter')).map(model => model.id)
}

describe('llm-pi-ai live catalog refresh in a real composition', () => {
  it('serves the published model the installed snapshot does not describe', async () => {
    vi.stubEnv('LIVE_CATALOG_KEY', 'key')
    const origin = await documentServer({ body: DOCUMENT })
    const ctx = await loadComposition(`${origin}/models`)

    const ids = await servedIds(ctx)

    expect(ids).toContain(ADDED_ID)
    // The installed catalog keeps serving beside the addition.
    expect(ids.length).toBe(catalogModels('openrouter').size + 1)
  })

  it('keeps serving the installed catalog when the document is unavailable', async () => {
    vi.stubEnv('LIVE_CATALOG_KEY', 'key')
    const origin = await documentServer({ status: 503, body: 'unavailable' })
    const ctx = await loadComposition(`${origin}/models`)

    const ids = await servedIds(ctx)

    // A refresh failure is not a route failure: the snapshot still serves.
    expect(ids).not.toContain(ADDED_ID)
    expect(ids.length).toBe(catalogModels('openrouter').size)
  })
})

describe('routes a refresh cannot widen', () => {
  it('skips a route whose installed models disagree on a protocol', async () => {
    vi.stubEnv('LIVE_CATALOG_KEY', 'key')
    // The Cloudflare gateway catalog spans multiple protocols, so an added model
    // has no single `api` to inherit and the route has to name one itself.
    const apis = new Set([...catalogModels('cloudflare-ai-gateway').values()].map(model => model.api))
    expect(apis.size).toBeGreaterThan(1)
    const origin = await documentServer({ body: DOCUMENT })
    const ctx = await loadComposition(`${origin}/models`, 'cloudflare-ai-gateway')

    const ids = (await ctx.llm.listModels('cloudflare-ai-gateway')).map(model => model.id)

    expect(ids).not.toContain(ADDED_ID)
    expect(ids.length).toBe(catalogModels('cloudflare-ai-gateway').size)
  })

  it('adds nothing when the document publishes only ids the snapshot already serves', async () => {
    vi.stubEnv('LIVE_CATALOG_KEY', 'key')
    const installedId = [...catalogModels('openrouter').keys()][0]!
    const origin = await documentServer({
      body: JSON.stringify({ data: [{ id: installedId, name: 'Published name' }] }),
    })
    const ctx = await loadComposition(`${origin}/models`)
    // The refresh runs as an effect; let it complete before counting, or the
    // assertion would hold even if the document had never been read.
    await new Promise(resolve => setTimeout(resolve, 200))

    const ids = (await ctx.llm.listModels('openrouter')).map(model => model.id)

    expect(ids.length).toBe(catalogModels('openrouter').size)
  })

  it('sizes an added model the document does not size from the route fallbacks', async () => {
    vi.stubEnv('LIVE_CATALOG_KEY', 'key')
    const origin = await documentServer({
      body: JSON.stringify({ data: [{ id: ADDED_ID, name: 'Acme Live Only' }] }),
    })
    const ctx = await loadComposition(`${origin}/models`, 'openrouter', [
      '      defaultContextWindow: 4096',
      '      defaultMaxTokens: 512',
    ])

    await servedIds(ctx)
    const info = await ctx.llm.resolveModelInfo('openrouter', ADDED_ID)

    expect(info?.context).toMatchObject({ contextWindow: 4096 })
  })
})

describe('disposal during a refresh', () => {
  it('stops a refresh still in flight without reporting it as a failure', async () => {
    vi.stubEnv('LIVE_CATALOG_KEY', 'key')
    const origin = await documentServer({ delayMs: 10_000, body: DOCUMENT })
    const ctx = await loadComposition(`${origin}/models`)
    const warn = vi.spyOn(ctx.logger, 'warn')

    // Disposal aborts the outstanding document request. A cancelled refresh is
    // not a refresh failure, so it must not warn about the provider's list.
    await ctx.fiber.dispose()
    context = undefined
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(warn.mock.calls.flat().join(' ')).not.toContain('could not refresh its model list')
  })
})
