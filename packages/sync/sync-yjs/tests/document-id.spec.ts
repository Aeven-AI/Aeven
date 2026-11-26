/**
 * Naming an account's documents derives the naming key once per account key, so a Consumer that asks for the ids of
 * hundreds of documents when the account connects, as the memory mirror does for its shards, pays one keyed hash per
 * name and not a key derivation per name.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { generateVaultKey, opaqueIdOf } from '@aeven/sync-vault'
import type { SyncOffload } from '../src/offload.ts'
import { SyncStore } from '../src/store.ts'
import { AccountVault, type VaultTuning } from '../src/vault.ts'

const derivations = vi.hoisted(() => ({ count: 0 }))
vi.mock('node:crypto', async (original) => {
  const actual = await original<typeof import('node:crypto')>()
  return {
    ...actual,
    hkdfSync: (...args: Parameters<typeof actual.hkdfSync>) => {
      derivations.count++
      return actual.hkdfSync(...args)
    },
  }
})

const TUNING: VaultTuning = {
  firstDocuments: [], compactAfter: 100, compactBytes: 8_388_608, snapshotAfter: 100, churnUpdates: 10_000, churnWindowMs: 3_600_000,
  applyFrames: 200, applyPauseMs: 0, pageFrames: 500, statusMs: 0, publishFrames: 100, publishBytes: 2_097_152,
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function vault(key: Uint8Array): { vault: AccountVault; store: SyncStore } {
  const dir = mkdtempSync(join(tmpdir(), 'sync-document-id-'))
  dirs.push(dir)
  const store = new SyncStore(join(dir, 'sync.db'), 'owner')
  store.setAccountKey(key, 'server')
  // Naming documents reaches neither the relay nor the sync worker.
  return { vault: new AccountVault(store, TUNING, () => {}, () => {}, () => {}, {} as SyncOffload, () => {}), store }
}

it('derives the naming key once for every document of an account, and again under another key', () => {
  const key = generateVaultKey()
  const { vault: named, store } = vault(key)
  const first = named.documentId('memory/traces/00')
  const after = derivations.count
  const ids = Array.from({ length: 200 }, (_unused, index) => named.documentId(`memory/traces/${String(index)}`))
  expect(derivations.count).toBe(after)
  expect(new Set(ids).size).toBe(200)
  // The ids are the ones a single derivation gives.
  const expected = opaqueIdOf(key, 'memory/traces/7')
  expect(ids[7]).toBe(expected)
  expect(named.documentId('memory/traces/00')).toBe(first)
  const next = generateVaultKey()
  store.setAccountKey(next, 'server')
  const before = derivations.count
  expect(named.documentId('memory/traces/7')).toBe(opaqueIdOf(next, 'memory/traces/7'))
  expect(named.documentId('memory/traces/8')).not.toBe(ids[8])
  // One derivation for the new key inside the vault, one for the expected id above.
  expect(derivations.count - before).toBe(2)
  store.close()
})
