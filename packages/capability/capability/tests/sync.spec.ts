/**
 * Learned capabilities across two devices of one account: a procedure saved on one device reaches the other with
 * its supporting files, and a removal there removes it here. Each device keeps its own execution log.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { MemorySyncNetwork, type MemorySyncDevice } from '../../../sync/sync/tests/memory.ts'
import Capabilities, { type Config } from '../src/index.ts'

const OWNER = 'owner-a'
const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'capability-sync-'))
  roots.push(root)
  return root
}

/** One device of the account, with its own capability directory and the account's synced document. */
function device(sync: MemorySyncDevice, root = scratch()): Capabilities {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('sync', sync.asSync())
  const service = new Capabilities(ctx, { root, trustAfter: 2, degradeAfter: 2 } satisfies Config)
  ctx.emit('sync/status', OWNER)
  return service
}

/** Wait until the probe reports a value, sampling instead of sleeping for a fixed time. */
async function until<T>(probe: () => Promise<T | undefined>, label: string): Promise<T> {
  for (let turn = 0; turn < 500; turn += 1) {
    const value = await probe()
    if (value !== undefined) return value
    await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
  }
  throw new Error(`timed out waiting for ${label}`)
}

const draft = { name: 'runs-the-build', description: 'Runs the build.', content: 'Run the build, then read its log.' }
const options = { status: 'learned', source: 'agent', sessionId: undefined } as const

describe('capabilities across devices', () => {
  it('gives the account\'s other device a procedure saved here, with its supporting files', async () => {
    const network = new MemorySyncNetwork()
    const a = device(network.device())
    const b = device(network.device())
    const saved = await a.save(OWNER, draft, options)
    await until(async () => (await b.list(OWNER)).length === 1 ? true : undefined, 'the capability on the second device')
    const arrived = await b.get(OWNER, draft.name)
    expect(arrived?.content).toBe(saved.content)
    expect(arrived?.revision).toBe(1)
    expect(arrived?.description).toBe(draft.description)
  })

  it('removes the procedure on the other device when it is removed here', async () => {
    const network = new MemorySyncNetwork()
    const a = device(network.device())
    const b = device(network.device())
    await a.save(OWNER, draft, options)
    await until(async () => (await b.list(OWNER)).length === 1 ? true : undefined, 'the capability on the second device')
    await a.remove(OWNER, draft.name)
    await until(async () => (await b.list(OWNER)).length === 0 ? true : undefined, 'the removal on the second device')
    expect(await b.get(OWNER, draft.name)).toBeUndefined()
  })

  it('keeps this device\'s execution log when another device\'s copy arrives, and drops files the copy lacks', async () => {
    const network = new MemorySyncNetwork()
    const a = device(network.device())
    const rootB = scratch()
    const b = device(network.device(), rootB)
    await a.save(OWNER, draft, options)
    await until(async () => (await b.list(OWNER)).length === 1 ? true : undefined, 'the capability on the second device')
    const find = (dir: string): string | undefined => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          const found = find(path)
          if (found !== undefined) return found
        } else if (entry.name === 'capability.json') {
          return dir
        }
      }
      return undefined
    }
    const directory = find(rootB)!
    writeFileSync(join(directory, 'executions.jsonl'), '{"kind":"execution"}\n')
    writeFileSync(join(directory, 'stale.md'), 'only here')
    await a.save(OWNER, { ...draft, content: 'Run the build twice.' }, options)
    await until(async () => (await b.get(OWNER, draft.name))?.content === 'Run the build twice.' ? true : undefined, 'the edit on the second device')
    expect(readFileSync(join(directory, 'executions.jsonl'), 'utf8')).toBe('{"kind":"execution"}\n')
    expect(existsSync(join(directory, 'stale.md'))).toBe(false)
  })
})
