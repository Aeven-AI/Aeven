/**
 * Waiting for a transfer folder: a complete folder resolves at once, an incomplete one at the deadline, and an aborted
 * wait resolves false without waiting for the deadline.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { FileSync, FileSyncFolderId, FileSyncFolderStatus } from '@aeven/file-sync'
import { brandString } from '@aeven/brand'
import { describe, expect, it } from 'vitest'
import { folderComplete, untilFolder } from '../src/wait.ts'

const folder = brandString<FileSyncFolderId>('00000000-0000-4000-8000-000000000000')
const idle: FileSyncFolderStatus = { state: 'idle', globalBytes: 1, globalFiles: 1, needBytes: 0, needFiles: 0, failedFiles: 0 }
const syncing: FileSyncFolderStatus = { ...idle, state: 'syncing', needBytes: 1, needFiles: 1 }

function transport(status: FileSyncFolderStatus): FileSync {
  return { status: () => status } as unknown as FileSync
}

// `untilFolder` only subscribes to folder events; no event fires in these cases.
const ctx = { on: () => () => {} } as unknown as Context

describe('folderComplete', () => {
  it('reports an idle folder whose content checks out', async () => {
    expect(await folderComplete(transport(idle), folder, () => Promise.resolve(true))).toBe(true)
  })

  it('reports a folder still receiving files as incomplete', async () => {
    expect(await folderComplete(transport(syncing), folder, () => Promise.resolve(true))).toBe(false)
  })
})

describe('untilFolder', () => {
  it('ends with false as soon as the signal aborts, before the deadline', async () => {
    const abort = new AbortController()
    const started = Date.now()
    const waiting = untilFolder(ctx, transport(syncing), folder, started + 60_000, () => Promise.resolve(true), abort.signal)
    abort.abort()
    expect(await waiting).toBe(false)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('ends with false at once for a signal that already aborted', async () => {
    const started = Date.now()
    const waiting = untilFolder(ctx, transport(syncing), folder, started + 60_000, () => Promise.resolve(true), AbortSignal.abort())
    expect(await waiting).toBe(false)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('ends with true for a folder that is already complete', async () => {
    expect(await untilFolder(ctx, transport(idle), folder, Date.now() + 60_000, () => Promise.resolve(true))).toBe(true)
  })
})
