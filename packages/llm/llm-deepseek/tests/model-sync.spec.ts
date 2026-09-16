/**
 * The platform model-list sync: reading ids out of the published document, the
 * additive merge that widens the shipped catalog, and the failure behaviour —
 * a route whose listing is unreachable, malformed, or silent keeps the models
 * it already ships.
 */

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekCatalogModel } from '@deepseek-ai/dsh-llm-deepseek'
import { fetchModelIds, parseModelIds, withSyncedModels } from '../src/model-sync.ts'

const servers: Server[] = []
const homes: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await Promise.all(servers.splice(0).map(server => new Promise((resolve) => { server.close(resolve) })))
  await Promise.all(homes.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/**
 * Serve one model document, optionally slowly enough to be cancelled mid-flight.
 * @param behavior - status, body, and an optional delay before responding.
 * @returns the listening origin and how many documents it has served.
 */
async function documentServer(
  behavior: { status?: number; body: string; delayMs?: number },
): Promise<{ url: string; hits: number }> {
  const handle = { url: '', hits: 0 }
  const server = createServer((_request, response) => {
    const send = (): void => {
      handle.hits += 1
      response.writeHead(behavior.status ?? 200, { 'content-type': 'application/json' })
      response.end(behavior.body)
    }
    if (behavior.delayMs === undefined) send()
    else setTimeout(send, behavior.delayMs)
  })
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the document server has no port')
  handle.url = `http://127.0.0.1:${String(address.port)}`
  return handle
}

/** A throwaway $AVN_HOME so the settings provider has a file to read. */
async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-deepseek-sync-'))
  homes.push(dir)
  return dir
}

const SHIPPED: DeepSeekCatalogModel[] = [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }]

describe('parseModelIds', () => {
  it('reads the published ids in document order', () => {
    expect(parseModelIds({ object: 'list', data: [{ id: 'b' }, { id: 'a' }] })).toEqual(['b', 'a'])
  })

  it('skips entries that carry no usable id, and repeats', () => {
    expect(parseModelIds({ data: [{ id: 'a' }, { id: '' }, {}, { id: 7 }, { id: 'a' }] })).toEqual(['a'])
  })

  it('states nothing for a document with no usable listing', () => {
    expect(parseModelIds(null)).toBeUndefined()
    expect(parseModelIds({ models: [] })).toBeUndefined()
    expect(parseModelIds({ data: [] })).toBeUndefined()
    expect(parseModelIds({ data: [{ id: '' }] })).toBeUndefined()
  })
})

describe('withSyncedModels', () => {
  it('adds an id the catalog does not describe, named by itself', () => {
    expect(withSyncedModels(SHIPPED, ['deepseek-flash', 'deepseek-v5'])).toEqual([
      { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
      { id: 'deepseek-v5', name: 'deepseek-v5' },
    ])
  })

  it('leaves every described entry exactly as the deployment wrote it', () => {
    const described: DeepSeekCatalogModel[] = [{ id: 'private', name: 'Private', contextWindow: 32_000 }]

    expect(withSyncedModels(described, ['private'])).toEqual(described)
  })

  it('keeps the catalog it was given when the platform stated nothing', () => {
    expect(withSyncedModels(SHIPPED, undefined)).toEqual(SHIPPED)
  })
})

describe('fetchModelIds', () => {
  it('reads the published list', async () => {
    const doc = await documentServer({ body: JSON.stringify({ object: 'list', data: [{ id: 'deepseek-v5' }] }) })

    await expect(fetchModelIds(`${doc.url}/models`, 5_000, 'key')).resolves.toEqual(['deepseek-v5'])
  })

  it('rejects a refused request and a body that is not JSON', async () => {
    const refused = await documentServer({ status: 500, body: '{}' })
    const notJson = await documentServer({ body: 'not json' })

    await expect(fetchModelIds(`${refused.url}/models`, 5_000, 'key')).rejects.toThrow('HTTP 500')
    await expect(fetchModelIds(`${notJson.url}/models`, 5_000, 'key')).rejects.toBeInstanceOf(Error)
  })
})

describe('the plugin sync', () => {
  /** Boot the plugin over a real settings file and one listing endpoint. */
  async function boot(baseURL: string, extra: object = {}): Promise<Context> {
    vi.stubEnv('AVN_HOME', await home())
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmDeepSeek, { baseURL, ...extra })
    return ctx
  }

  it('advertises the ids the platform publishes beyond the shipped catalog', async () => {
    const doc = await documentServer({
      body: JSON.stringify({ object: 'list', data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v5' }] }),
    })
    const ctx = await boot(doc.url)
    try {
      await vi.waitFor(async () => {
        await expect(ctx.llm.listModels('deepseek-official')).resolves.toMatchObject([
          { id: 'deepseek-flash' },
          { id: 'deepseek-v4-pro' },
          { id: 'deepseek-v5', name: 'deepseek-v5' },
        ])
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps the shipped catalog when the platform list is refused or states nothing', async () => {
    const refused = await documentServer({ status: 500, body: '{}' })
    const ctx = await boot(refused.url)
    const warn = vi.spyOn(ctx.logger, 'warn')
    try {
      await vi.waitFor(() => { expect(warn).toHaveBeenCalled() })
      await expect(ctx.llm.listModels('deepseek-official')).resolves.toHaveLength(2)
    } finally {
      await ctx.fiber.dispose()
    }
    // A listing that answers with nothing usable is not a failure: no warning.
    const silent = await documentServer({ body: JSON.stringify({ data: [] }) })
    const quiet = await boot(silent.url)
    const quietWarn = vi.spyOn(quiet.logger, 'warn')
    try {
      await expect(quiet.llm.listModels('deepseek-official')).resolves.toHaveLength(2)
      expect(quietWarn).not.toHaveBeenCalled()
    } finally {
      await quiet.fiber.dispose()
    }
  })

  it('answers the Models page discovery from the catalog it advertises', async () => {
    const doc = await documentServer({
      body: JSON.stringify({ object: 'list', data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v5' }] }),
    })
    const ctx = await boot(doc.url)
    try {
      await vi.waitFor(async () => {
        await expect(ctx.llm.discoverModels('llm-deepseek', { provider: 'deepseek-official' }))
          .resolves.toEqual([
            {
              id: 'deepseek-flash',
              name: 'DeepSeek-V4.1-Flash',
              contextWindow: 1_000_000,
            },
            {
              id: 'deepseek-v4-pro',
              name: 'DeepSeek-V4-Pro',
              contextWindow: 1_000_000,
            },
            // A synced id carries only what the platform published: its name.
            { id: 'deepseek-v5', name: 'deepseek-v5' },
          ])
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('carries a configured cap into the discovery answer, and stops when the list adds nothing', async () => {
    // The platform listing matches what the catalog already describes, so the
    // answer adds nothing and the catalog, memo, and registry all stay put.
    const doc = await documentServer({
      body: JSON.stringify({ object: 'list', data: [{ id: 'deepseek-flash' }] }),
    })
    const ctx = await boot(doc.url)
    try {
      // The attempt still runs and still answers with nothing to add.
      await vi.waitFor(() => { expect(doc.hits).toBe(1) })
      await expect(ctx.llm.discoverModels('llm-deepseek', { provider: 'deepseek-official' }))
        .resolves.toEqual([
          { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', contextWindow: 1_000_000 },
          { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1_000_000 },
        ])
    } finally {
      await ctx.fiber.dispose()
    }

    // A catalog entry that names its own output cap carries it through, and a
    // listing whose ids are all described leaves the catalog alone.
    const described = await documentServer({
      body: JSON.stringify({ object: 'list', data: [{ id: 'sized' }] }),
    })
    const sized = await boot(described.url, { models: [{ id: 'sized', maxTokens: 1_024 }] })
    try {
      await vi.waitFor(() => { expect(described.hits).toBe(1) })
      // An entry that names no display name is reported without one; only the
      // fields the entry states reach the answer.
      await expect(sized.llm.discoverModels('llm-deepseek', { provider: 'deepseek-official' }))
        .resolves.toEqual([{ id: 'sized', maxTokens: 1_024 }])
      await expect(sized.llm.listModels('deepseek-official')).resolves.toHaveLength(1)
    } finally {
      await sized.fiber.dispose()
    }
  })

  it('drops an in-flight listing when the plugin unloads', async () => {
    const slow = await documentServer({
      body: JSON.stringify({ data: [{ id: 'deepseek-v5' }] }),
      delayMs: 2_000,
    })
    const ctx = await boot(slow.url)
    const warn = vi.spyOn(ctx.logger, 'warn')
    await ctx.fiber.dispose()
    // The aborted request settles as a cancellation rather than a failure, so
    // it stays quiet instead of reporting the platform as unavailable.
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    expect(warn).not.toHaveBeenCalled()
  })
})
