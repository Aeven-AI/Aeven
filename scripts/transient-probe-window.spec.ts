import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTransientProbeWindow } from './transient-probe-window.ts'

/** One private lock root per case, so two cases never share a lock path. */
const roots: string[] = []

async function lockRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'avn-probe-window-'))
  roots.push(root)
  return join(root, 'window')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('transient probe window', () => {
  it('releases the lock when the operation returns', async () => {
    const filename = await lockRoot()
    const hold = createTransientProbeWindow(filename)

    await expect(hold(async () => 'done')).resolves.toBe('done')
    expect(existsSync(`${filename}.lock`)).toBe(false)
  })

  it('releases the lock when the operation throws', async () => {
    const filename = await lockRoot()
    const hold = createTransientProbeWindow(filename)

    await expect(hold(async () => {
      throw new Error('probe failed')
    })).rejects.toThrow('probe failed')
    expect(existsSync(`${filename}.lock`)).toBe(false)
  })

  it('holds a second window until the first one closes', async () => {
    const filename = await lockRoot()
    const hold = createTransientProbeWindow(filename)
    const order: string[] = []

    const first = hold(async () => {
      order.push('first entered')
      await new Promise(resolve => setTimeout(resolve, 120))
      order.push('first left')
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    const second = hold(async () => {
      order.push('second entered')
    })
    await Promise.all([first, second])

    expect(order).toEqual(['first entered', 'first left', 'second entered'])
  })

  it('reaps a lock left behind by a process that no longer exists', async () => {
    const filename = await lockRoot()
    // An id no live process holds: the runner's own pid plus a wide margin.
    await writeFile(`${filename}.lock`, `${process.pid + 1_000_000}\n`)
    const hold = createTransientProbeWindow(filename, { waitMs: 200 })

    await expect(hold(async () => 'recovered')).resolves.toBe('recovered')
    expect(existsSync(`${filename}.lock`)).toBe(false)
  })

  it('reaps a lock whose recorded owner is not a process id', async () => {
    const filename = await lockRoot()
    await writeFile(`${filename}.lock`, 'not-a-pid\n')
    const hold = createTransientProbeWindow(filename, { waitMs: 200 })

    await expect(hold(async () => 'recovered')).resolves.toBe('recovered')
  })

  it('keeps waiting while a live process holds the lock', async () => {
    const filename = await lockRoot()
    await writeFile(`${filename}.lock`, `${process.pid}\n`)
    const hold = createTransientProbeWindow(filename, { waitMs: 150 })

    await expect(hold(async () => 'unreachable')).rejects.toThrow(/timed out waiting/)
    await expect(readFile(`${filename}.lock`, 'utf8')).resolves.toBe(`${process.pid}\n`)
  })
})
