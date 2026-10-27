/**
 * Preferences across two devices of one account: changes merge per field, a device that never changed
 * anything does not seed defaults over another device's choices, and a voice this build does not offer keeps
 * the current one.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemorySyncNetwork, type MemorySyncDevice } from '../../../sync/sync/tests/memory.ts'
import { PersonalizationStore } from '../src/store.ts'
import { PersonalizationSync } from '../src/sync.ts'
import type { PersonalizationVoice } from '../src/types.ts'

const OWNER = 'owner-1'
const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function home(device: MemorySyncDevice): { store: PersonalizationStore; sync: PersonalizationSync; warn: ReturnType<typeof vi.fn> } {
  const root = mkdtempSync(join(tmpdir(), 'personalization-sync-'))
  const store = new PersonalizationStore(root, 1500, 20000)
  const warn = vi.fn()
  const sync = new PersonalizationSync({ get: () => device.asSync() } as never, store, warn)
  cleanups.push(() => { rmSync(root, { recursive: true, force: true }) }, () => sync.dispose())
  return { store, sync, warn }
}

describe('personalization sync', () => {
  it('merges each field independently between devices', async () => {
    const network = new MemorySyncNetwork()
    const a = home(network.device())
    const b = home(network.device())
    await b.sync.attach(OWNER)
    const changed = a.store.update(OWNER, { voice: 'warm', notes: 'Call me Olivier.' })
    await a.sync.publish(OWNER, changed.state)
    await vi.waitFor(() => { expect(b.store.read(OWNER)).toMatchObject({ voice: 'warm', notes: 'Call me Olivier.' }) })
    const fromB = b.store.update(OWNER, { masterPrompt: 'Be brief.' })
    await b.sync.publish(OWNER, fromB.state)
    await vi.waitFor(() => { expect(a.store.read(OWNER)).toMatchObject({ voice: 'warm', masterPrompt: 'Be brief.' }) })
  })

  it('seeds an empty document only from a caught-up device whose person changed something', async () => {
    const network = new MemorySyncNetwork()
    const plain = home(network.device())
    await plain.sync.attach(OWNER)
    const doc = await network.devices[0]!.asSync().openDocument(OWNER, 'personalization')
    expect(doc.doc.getMap('preferences').size).toBe(0)

    const customized = home(network.device())
    customized.store.update(OWNER, { notes: 'Prefers short answers.' })
    await customized.sync.attach(OWNER)
    await vi.waitFor(() => { expect(plain.store.read(OWNER).notes).toBe('Prefers short answers.') })
  })

  it('takes a document another device wrote, keeping the current voice for one it does not offer', async () => {
    const network = new MemorySyncNetwork()
    const device = network.device()
    const target = home(device)
    const doc = await device.asSync().openDocument(OWNER, 'personalization')
    doc.doc.getMap('preferences').set('voice', 'operatic' as PersonalizationVoice)
    doc.doc.getMap('preferences').set('notes', 'n')
    doc.doc.getMap('preferences').set('masterPrompt', '')
    await target.sync.attach(OWNER)
    expect(target.store.read(OWNER)).toMatchObject({ voice: 'automatic', notes: 'n' })
    expect(target.store.apply(OWNER, target.store.read(OWNER))).toBe(false)
  })

  it('does nothing while sync does not serve the account, and reports a document it cannot open', async () => {
    const network = new MemorySyncNetwork()
    const unenrolled = home(network.device('unenrolled'))
    expect(await unenrolled.sync.attach(OWNER)).toBeUndefined()
    const root = mkdtempSync(join(tmpdir(), 'personalization-sync-'))
    cleanups.push(() => { rmSync(root, { recursive: true, force: true }) })
    const warn = vi.fn()
    const failing = new PersonalizationSync({ get: () => ({ status: () => ({ state: 'online' }), openDocument: () => Promise.reject(new Error('locked')) }) } as never, new PersonalizationStore(root, 10, 10), warn)
    expect(await failing.attach(OWNER)).toBeUndefined()
    expect(warn).toHaveBeenCalledWith('personalization: opening the synced document failed: locked')
    const absent = new PersonalizationSync({ get: () => undefined } as never, new PersonalizationStore(root, 10, 10), warn)
    expect(await absent.attach(OWNER)).toBeUndefined()
  })
})
