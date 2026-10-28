/** A Loader-composed Host whose session sync talks to one device of an in-memory account network. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore from '@aeven/session'
import JsonlPersistence from '@aeven/session-persistence-jsonl'
import { afterEach, expect } from 'vitest'
import SessionSync from '../src/index.ts'
import type { MemorySyncDevice } from '../../../sync/sync/tests/memory.ts'

const hosts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/**
 * Boot one Host with its own durable home, serving `device` as `ctx.sync`.
 * @param device - the account network device this Host uses.
 * @returns the started Host.
 */
export async function host(device: MemorySyncDevice): Promise<Context> {
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
