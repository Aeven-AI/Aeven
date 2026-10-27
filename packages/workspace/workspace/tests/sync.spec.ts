/**
 * Workspaces across two devices of one account: a workspace registered on one device reaches the other without its
 * directory path, a removal travels, and a workspace this device opened itself keeps its own path.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@aeven/storage'
import { DomainFacility } from '@aeven/storage-domain'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { MemorySyncNetwork, type MemorySyncDevice } from '../../../sync/sync/tests/memory.ts'
import WorkspaceRegistry from '../src/index.ts'

const OWNER = 'owner-a'
const contexts: Context[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function folder(label: string): Promise<string> {
  const directory = mkdtemp(join(tmpdir(), `workspace-sync-${label}-`))
  const path = await realpath(await directory)
  directories.push(path)
  return path
}

/** One device of the account: its own storage, and the account's synced document. */
async function device(sync: MemorySyncDevice): Promise<WorkspaceRegistry> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('sessionPersistence', { list: async () => [], load: () => { throw new Error('unused') }, inspect: () => { throw new Error('unused') } } as never)
  ctx.provide('sync', sync.asSync())
  await ctx.plugin(WorkspaceRegistry, { seedDefaultWorkspace: false })
  ctx.emit('sync/status', OWNER)
  return ctx.workspaceRegistry
}

/** Wait until the probe reports a value, sampling instead of sleeping for a fixed time. */
async function until<T>(probe: () => T | undefined, label: string): Promise<T> {
  for (let turn = 0; turn < 500; turn += 1) {
    const value = probe()
    if (value !== undefined) return value
    await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
  }
  throw new Error(`timed out waiting for ${label}`)
}

const titles = (registry: WorkspaceRegistry) => registry.list().map(workspace => workspace.title)

describe('workspaces across devices', () => {
  it('gives the account\'s other device a workspace registered here, without its path', async () => {
    const network = new MemorySyncNetwork()
    const a = await device(network.device())
    const b = await device(network.device())
    await a.create(await folder('a'), 'Research', OWNER)
    await until(() => titles(b).includes('Research') ? true : undefined, 'the workspace on the second device')
    const arrived = b.list().find(workspace => workspace.title === 'Research')
    // A directory lives on the device that opened it, so the copy here has no path of its own yet.
    expect(arrived?.kind).toBe('remote')
    expect(arrived?.path).toBeUndefined()
  })

  it('removes the workspace on the other device when it is removed here', async () => {
    const network = new MemorySyncNetwork()
    const a = await device(network.device())
    const b = await device(network.device())
    const created = await a.create(await folder('a'), 'Research', OWNER)
    await until(() => titles(b).includes('Research') ? true : undefined, 'the workspace on the second device')
    await a.delete(created.id)
    await until(() => titles(b).includes('Research') ? undefined : true, 'the removal on the second device')
    expect(titles(b)).toEqual([])
  })

  it('keeps a workspace this device opened, with its own path, when the account\'s arrive', async () => {
    const network = new MemorySyncNetwork()
    const a = await device(network.device())
    const b = await device(network.device())
    const mine = await folder('b')
    const own = await b.create(mine, 'Local notes', OWNER)
    await a.create(await folder('a'), 'Research', OWNER)
    await until(() => titles(b).includes('Research') ? true : undefined, 'the workspace on the second device')
    const kept = b.list().find(workspace => workspace.id === own.id)
    expect(kept?.kind).toBe('folder')
    expect(kept?.path).toBe(mine)
    // The account's order places its own workspaces, and a row only this device holds keeps its place beside them.
    expect(titles(b)).toHaveLength(2)
    expect(titles(b)).toEqual(expect.arrayContaining(['Local notes', 'Research']))
  })
})
