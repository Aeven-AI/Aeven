/**
 * Workspaces across two devices of one account: a workspace registered on one device reaches the other without its
 * directory path, a removal travels and archives the workspace's sessions there, a workspace this device opened
 * itself keeps its own path, a received workspace binds a directory of this device, a device that has not received
 * a workspace yet never removes it, and a session another device published is filed into its workspace here.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@aeven/storage'
import { DomainFacility } from '@aeven/storage-domain'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { SESSION_FORMAT_VERSION, SessionId, type SessionHeader } from '@aeven/session'
import { MemorySyncNetwork, type MemorySyncDevice } from '../../../sync/sync/tests/memory.ts'
import WorkspaceRegistry, { type WorkspaceId } from '../src/index.ts'

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
async function device(
  sync: MemorySyncDevice, headers: SessionHeader[] = [], seed = false, shared: SessionId[] = [],
): Promise<WorkspaceRegistry> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve(headers),
    load: () => { throw new Error('unused') },
    inspect: () => { throw new Error('unused') },
  } as never)
  ctx.provide('sync', sync.asSync())
  if (shared.length > 0) ctx.provide('sessionHandoff', { shared: (_owner: string, id: SessionId) => shared.includes(id) } as never)
  await ctx.plugin(WorkspaceRegistry, { seedDefaultWorkspace: seed })
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
  it('keeps a promoted shared session in its local workspace despite the other device’s header path', async () => {
    const network = new MemorySyncNetwork()
    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION, id: SessionId('promoted'), createdAt: 1, isSeeded: false, owner: OWNER, cwd: '/other-device/project',
    }
    const registry = await device(network.device(), [header], false, [header.id])
    const workspace = await registry.create(await folder('promoted'), 'Project', OWNER)
    await workspace.attachSession(header.id)
    expect(workspace.sessionIds).toEqual([header.id])
    expect(registry.sessionHome(header.id)).toBe(workspace.id)
  })

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

  it('binds a received workspace to a directory of this device, refusing one it cannot use', async () => {
    const network = new MemorySyncNetwork()
    const a = await device(network.device())
    const b = await device(network.device())
    const pathA = await folder('a')
    const created = await a.create(pathA, 'Research', OWNER)
    await until(() => titles(b).includes('Research') ? true : undefined, 'the workspace on the second device')
    const pathB = await folder('b')
    const bound = await b.bind(created.id, pathB)
    expect(bound).toMatchObject({ kind: 'folder', path: pathB })
    await expect(b.bind(created.id, pathB)).resolves.toMatchObject({ kind: 'folder', path: pathB })
    await expect(b.bind('missing' as WorkspaceId, pathB)).rejects.toThrow(/no workspace/)
    const other = await b.create(await folder('other'), 'Other', OWNER)
    const third = await a.create(await folder('third'), 'Third', OWNER)
    await until(() => titles(b).includes('Third') ? true : undefined, 'the third workspace on the second device')
    await expect(b.bind(third.id, other.path!)).rejects.toThrow(/already the directory of workspace 'Other'/)
    const file = join(pathB, 'notes.txt')
    await writeFile(file, 'x')
    await expect(b.bind(third.id, file)).rejects.toThrow(/not a directory/)
    await a.get(created.id)!.setTitle('Research 2')
    await until(() => titles(b).includes('Research 2') ? true : undefined, 'the renamed workspace on the second device')
    // The directory stays on each device.
    expect(a.get(created.id)?.path).toBe(pathA)
    expect(b.get(created.id)?.path).toBe(pathB)
  })

  it('never removes a workspace it has not received yet, and archives the sessions of one removed elsewhere', async () => {
    const network = new MemorySyncNetwork()
    const writer = await network.device().asSync().openDocument(OWNER, 'workspaces')
    writer.doc.getMap('records').set('elsewhere', { title: 'Elsewhere', owner: OWNER, createdAt: 'x', updatedAt: '2026-01-01T00:00:00.000Z' })
    const session: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId('chat-1'), createdAt: 1, isSeeded: false, owner: OWNER }
    const b = await device(network.device(), [session])
    await b.create(await folder('b'), 'Mine', OWNER)
    await until(() => titles(b).includes('Elsewhere') ? true : undefined, 'the received workspace')
    expect((writer.doc.getMap('records').get('elsewhere') as { removed?: boolean }).removed).toBeUndefined()
    await b.get('elsewhere' as WorkspaceId)!.attachSession(session.id)
    writer.doc.getMap('records').set('elsewhere', { removed: true, title: 'Elsewhere', updatedAt: '2026-02-01T00:00:00.000Z' })
    await until(() => titles(b).includes('Elsewhere') ? undefined : true, 'the removal')
    expect(b.archivedSessionIds).toContain(session.id)
  })

  it('files a session another device published into its workspace, with a cwd from that device', async () => {
    const network = new MemorySyncNetwork()
    const a = await device(network.device())
    const replica: SessionHeader = {
      version: SESSION_FORMAT_VERSION, id: SessionId('from-a'), createdAt: 1, isSeeded: false, owner: OWNER, cwd: '/Users/a/research', replica: true,
    }
    const plain: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId('plain'), createdAt: 2, isSeeded: false, owner: OWNER }
    const b = await device(network.device(), [replica, plain], true)
    const created = await a.create(await folder('a'), 'Research', OWNER)
    await until(() => titles(b).includes('Research') ? true : undefined, 'the workspace on the second device')
    expect(await b.fileSession(replica.id, 'unknown')).toBe(false)
    expect(await b.fileSession(replica.id, created.id)).toBe(true)
    expect(await b.fileSession(replica.id, created.id)).toBe(true)
    expect(b.sessionHome(replica.id)).toBe(created.id)
    await b.bind(created.id, await folder('b'))
    expect(b.get(created.id)?.sessionIds).toEqual([replica.id])
    expect(await b.fileSession(plain.id, 'default')).toBe(true)
    expect(b.sessionHome(plain.id)).toBe('default')
    expect(b.sessionHome(SessionId('nowhere'))).toBeUndefined()
    const built = await b.builtIn('automations', 'Automations')
    const runSession: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId('run'), createdAt: 3, isSeeded: false, owner: OWNER }
    const c = await device(network.device(), [runSession], true)
    await c.builtIn('automations', 'Automations')
    expect(await c.fileSession(runSession.id, 'builtin:automations')).toBe(true)
    expect(c.sessionHome(runSession.id)).toBe('builtin:automations')
    expect(await c.fileSession(runSession.id, 'builtin:missing')).toBe(false)
    expect(built.isBuiltIn).toBe(true)
  })
})
