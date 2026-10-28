/** Session handover through Loader compositions with independent durable homes. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId } from '@aeven/session'
import JsonlPersistence from '@aeven/session-persistence-jsonl'
import { createUserMessage } from '@aeven/llm'
import { afterEach, expect, it, vi } from 'vitest'
import SessionSync from '../src/index.ts'
import { MemorySyncNetwork, type MemorySyncDevice } from '../../../sync/sync/tests/memory.ts'

const hosts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function host(device: MemorySyncDevice): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'avn-sync-handover-'))
  roots.push(root)
  const path = join(root, 'cordis.yml')
  await writeFile(path, [
    "- name: '@aeven/session'",
    "- name: '@aeven/session-persistence-jsonl'",
    `  config: { root: ${JSON.stringify(join(root, 'sessions'))}, compression: none, writeBatchMaxDelayMs: 1 }`,
    "- name: 'test:sync-transport'",
    "- name: '@aeven/session-sync'",
    '  config: { publishMs: 250, liveMs: 1 }',
    '',
  ].join('\n'))
  const ctx = new Context()
  hosts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const transport = { name: 'sync-test-transport', apply: (scope: Context) => { scope.provide('sync', device.asSync()) } }
  const modules = new Map<string, unknown>([
    ['@aeven/session', SessionStore], ['@aeven/session-persistence-jsonl', JsonlPersistence],
    ['test:sync-transport', transport], ['@aeven/session-sync', SessionSync],
  ])
  ctx.loader.internal = {
    version: 'v2',
    import: (name: string) => {
      if (!modules.has(name)) throw new Error(`unexpected Loader import: ${name}`)
      return Promise.resolve(modules.get(name))
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
  await ctx.loader.await()
  expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
  ctx.emit('sync/status', 'account')
  return ctx
}

it('continues the same durable conversation on either device without a fork or an extra session', async () => {
  const network = new MemorySyncNetwork()
  const a = await host(network.device())
  const b = await host(network.device())
  const id = SessionId('same-conversation')
  let detach: (() => void) | undefined
  a.on('session-handoff/released', () => { detach?.(); detach = undefined })
  const original = a.sessions.prepare(id, { meta: { owner: 'account' } })
  detach = a.sessions.enter(original)
  a.sessions.announce(original)
  expect(await a.sessionHandoff.claim('account', id)).toEqual({ claimed: true })
  await a.sessionHandoff.holdRunner('account', id, true)
  original.append('turn/start', { turn: 1 })
  original.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'from A' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  original.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await a.parallel('session/flush', original)
  await vi.waitFor(async () => { expect((await b.sessionPersistence.list()).map(header => header.id)).toEqual([id]) })
  expect(await b.sessionHandoff.claim('account', id)).toEqual({ claimed: false })
  await a.sessionHandoff.holdRunner('account', id, false)
  const location = b.sessionPersistence.locate((await b.sessionPersistence.list())[0]!)!
  if (location.kind !== 'jsonl') throw new Error('expected a JSONL log')
  const prefix = await readFile(location.path)
  expect(await b.sessionHandoff.claim('account', id)).toEqual({ claimed: true })
  expect(await readFile(location.path)).toEqual(prefix)
  using prepared = await b.sessionPersistence.prepare(id)
  const continued = prepared.session
  const leave = b.sessions.enter(continued)
  b.sessions.announce(continued)
  b.on('session-handoff/released', () => { leave() })
  await b.sessionHandoff.holdRunner('account', id, true)
  continued.append('turn/start', { turn: 2 })
  continued.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'from B' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  continued.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  await b.sessionHandoff.holdRunner('account', id, false)
  await vi.waitFor(async () => {
    const copy = await a.sessionPersistence.readFrom(id, 0 as never)
    expect(copy.events.filter(event => event.type === 'user/message')).toHaveLength(2)
  })
  expect((await a.sessionPersistence.list()).map(header => header.id)).toEqual([id])
  expect((await b.sessionPersistence.list()).map(header => header.id)).toEqual([id])
  expect(await a.sessionHandoff.claim('account', id)).toEqual({ claimed: true })
})
