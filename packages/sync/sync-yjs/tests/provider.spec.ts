/**
 * The Yjs sync provider on Hosts with separate homes against an in-process relay: an account starts syncing when
 * one of its clients signs in, carries edits between Hosts, lists its devices, stops and resumes with the device
 * switch, coordinates leases, resumes after a restart, and handles a missing session token or relay.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { credentialRef } from '@aeven/credentials'
import type { Sync } from '@aeven/sync'
import YjsSync from '../src/index.ts'
import { FakeRelay } from './fake-relay.ts'

let relay: FakeRelay
const cleanups: Array<() => Promise<void> | void> = []
let accounts = 0
beforeAll(async () => { relay = await FakeRelay.start() })
afterAll(async () => { await relay.stop() })
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllEnvs()
})

interface Host {
  ctx: Context
  sync: Sync
  fiber: Fiber
  home: string
  documents: string[]
  signIn(owner: string): void
}

/** Owners whose token never resolves, as when no client of the account holds a session. */
const signedOut = new Set<string>()

async function host(options: { home?: string; relayUrl?: string; deviceName?: string } = {}): Promise<Host> {
  const home = options.home ?? mkdtempSync(join(tmpdir(), 'sync-host-'))
  if (options.home === undefined) cleanups.push(() => { rmSync(home, { recursive: true, force: true }) })
  vi.stubEnv('AVN_HOME', home)
  const ctx = new Context()
  ctx.provide('credentials', {
    resolve: (_ref: unknown, owner: string) => Promise.resolve(signedOut.has(owner) ? undefined : { value: `ok-${owner}`, source: 'session' }),
  } as never)
  const documents: string[] = []
  ctx.on('sync/document', (_owner, id) => { documents.push(id) })
  const fiber = ctx.plugin(YjsSync, {
    relayUrl: options.relayUrl ?? relay.url, credentialRef: 'AEVEN_TOKEN', deviceName: options.deviceName ?? 'test-host',
    reconnectMs: 100, connectTimeoutMs: 2000, requestTimeoutMs: 2000, compactAfter: 50, snapshotAfter: 50, applyFrames: 200,
    applyPauseMs: 0, pageFrames: 500, statusMs: 0, publishFrames: 100, publishBytes: 2_097_152,
    lan: false, lanPort: 0, lanRetryMs: 100, lanMaxBytes: 65_536,
  })
  await fiber
  cleanups.push(() => fiber.dispose())
  const signIn = (owner: string): void => {
    // Each Host keeps its accounts under its own home, which the provider reads when an account starts.
    vi.stubEnv('AVN_HOME', home)
    ctx.emit('credentials/session-updated', credentialRef('AEVEN_TOKEN'), owner)
  }
  return { ctx, sync: ctx.sync, fiber, home, documents, signIn }
}

const owner = (): string => `owner${String(++accounts)}`

async function online(target: Host, account: string): Promise<void> {
  await vi.waitFor(() => { expect(target.sync.status(account).state).toBe('online') })
}

describe('the Yjs sync provider', () => {
  it('reports an account it has never seen as starting and refuses document work for it', async () => {
    const { sync } = await host()
    expect(sync.status('nobody')).toEqual({ state: 'starting', pending: 0, queued: 0 })
    expect(() => sync.documentId('nobody', 'doc')).toThrow(/does not sync/)
    expect(() => sync.storedDocuments('nobody')).toThrow(/does not sync/)
    await expect(sync.openDocument('nobody', 'doc')).rejects.toThrow(/does not sync/)
    await expect(sync.devices('nobody')).rejects.toThrow(/does not sync/)
  })

  it('syncs an account once one of its clients signs in, and carries edits between Hosts', async () => {
    const account = owner()
    const first = await host({ deviceName: 'laptop' })
    const second = await host({ deviceName: 'desktop' })
    first.signIn(account)
    second.signIn(account)
    // A session credential for another reference is not the account's token.
    first.ctx.emit('credentials/session-updated', credentialRef('OTHER'), 'stranger')
    expect(first.sync.status('stranger').state).toBe('starting')
    await online(first, account)
    await online(second, account)

    const mine = await first.sync.openDocument(account, 'notes')
    const theirs = await second.sync.openDocument(account, 'notes')
    mine.doc.getMap('m').set('k', 'from laptop')
    await vi.waitFor(() => { expect(theirs.doc.getMap('m').get('k')).toBe('from laptop') })
    expect(second.documents).toContain(second.sync.documentId(account, 'notes'))
    theirs.doc.getMap('m').set('k', 'from desktop')
    await vi.waitFor(() => { expect(mine.doc.getMap('m').get('k')).toBe('from desktop') })
    await vi.waitFor(() => { expect(first.sync.status(account)).toMatchObject({ pending: 0, queued: 0 }) })
    expect(first.sync.storedDocuments(account)).toContain(first.sync.documentId(account, 'notes'))
    await vi.waitFor(async () => {
      expect((await first.sync.devices(account)).map(device => [device.name, device.current])).toEqual([['laptop', true], ['desktop', false]])
    })
    mine.close()
    theirs.close()
  })

  it('stops syncing a device the user turned off and catches up once it is turned on again', async () => {
    const account = owner()
    const first = await host()
    const second = await host()
    first.signIn(account)
    second.signIn(account)
    await online(first, account)
    await online(second, account)
    second.sync.setEnabled(account, false)
    expect(second.sync.status(account).state).toBe('disabled')
    await expect(second.sync.openDocument(account, 'notes')).rejects.toThrow(/does not sync/)

    const mine = await first.sync.openDocument(account, 'notes')
    mine.doc.getMap('m').set('k', 'while off')
    await vi.waitFor(() => { expect(first.sync.status(account).pending).toBe(0) })
    second.sync.setEnabled(account, true)
    await online(second, account)
    const theirs = await second.sync.openDocument(account, 'notes')
    await vi.waitFor(() => { expect(theirs.doc.getMap('m').get('k')).toBe('while off') })
    mine.close()
    theirs.close()
  })

  it('coordinates exclusive work across Hosts without exposing its logical name', async () => {
    const account = owner()
    const first = await host()
    await expect(first.sync.acquireLease(account, 'memory/maintenance', 30_000)).rejects.toThrow(/connected/)
    await expect(first.sync.releaseLease(account, 'memory/maintenance')).rejects.toThrow(/connected/)
    const second = await host()
    first.signIn(account)
    second.signIn(account)
    await online(first, account)
    await online(second, account)

    const winner = await first.sync.acquireLease(account, 'memory/maintenance', 30_000)
    expect(winner).toMatchObject({ granted: true, holder: first.sync.status(account).device })
    expect(await second.sync.acquireLease(account, 'memory/maintenance', 30_000)).toEqual({ ...winner, granted: false })
    expect([...relay.account(account).leases.keys()]).not.toContain('memory/maintenance')
    await first.sync.releaseLease(account, 'memory/maintenance')
    expect((await second.sync.acquireLease(account, 'memory/maintenance', 30_000)).granted).toBe(true)
    relay.replies.set('lease.acquire', [{ granted: 'yes', holder: 'someone-else', expiresAt: 1 }])
    await expect(first.sync.acquireLease(account, 'memory/maintenance', 30_000)).rejects.toThrow(/invalid lease/)
  })

  it('resumes an account after a restart, offline first and online once its token resolves', async () => {
    const account = owner()
    const first = await host()
    first.signIn(account)
    await online(first, account)
    const doc = await first.sync.openDocument(account, 'notes')
    doc.doc.getMap('m').set('k', 'kept')
    doc.close()
    await vi.waitFor(() => { expect(first.sync.status(account).pending).toBe(0) })
    await first.fiber.dispose()

    signedOut.add(account)
    const again = await host({ home: first.home })
    expect(again.sync.status(account).state).toBe('offline')
    const reopened = await again.sync.openDocument(account, 'notes')
    expect(reopened.doc.getMap('m').get('k')).toBe('kept')
    reopened.close()
    signedOut.delete(account)
    await online(again, account)
  })

  it('waits for a session token and for a reachable relay', async () => {
    const account = owner()
    signedOut.add(account)
    const waiting = await host()
    waiting.signIn(account)
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(waiting.sync.status(account).state).toBe('starting')
    signedOut.delete(account)
    await online(waiting, account)

    const unreachable = await host({ relayUrl: 'ws://127.0.0.1:9/sync' })
    const lonely = owner()
    unreachable.signIn(lonely)
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(unreachable.sync.status(lonely).state).toBe('starting')
  })

  it('publishes a long outbox in batches and drops a frame the relay refuses outright', async () => {
    const account = owner()
    const first = await host()
    first.signIn(account)
    await online(first, account)
    const warn = vi.spyOn(first.ctx.logger, 'warn').mockImplementation(() => {})
    relay.refusals.set('publish', ['too-large'])
    const doc = await first.sync.openDocument(account, 'notes')
    for (let i = 0; i < 250; i++) doc.doc.getMap('m').set(String(i), i)
    await vi.waitFor(() => { expect(first.sync.status(account).pending).toBe(0) })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('refused a frame (too-large)'))
    expect(relay.account(account).frames.length).toBeGreaterThan(0)
    doc.close()
  })
})
