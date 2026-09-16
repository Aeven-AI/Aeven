import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOST_LEASE_VERSION, hostLeasePath } from '@aeven/home-paths'
import { planDesktopBackend } from '../src/attached-host.ts'

const homes: string[] = []

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-attach-'))
  homes.push(home)
  return home
}

async function advertise(home: string, pid: number, url?: string): Promise<void> {
  await mkdir(join(home, 'runtime'), { recursive: true })
  await writeFile(hostLeasePath(home), JSON.stringify({
    version: HOST_LEASE_VERSION,
    pid,
    startedAt: '2026-09-14T00:00:00.000Z',
    ...(url === undefined ? {} : { url }),
  }), 'utf8')
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

describe('desktop backend selection', () => {
  it('starts its own Host when the home advertises nothing', async () => {
    const home = await makeHome()
    const probe = vi.fn(async () => true)
    expect(await planDesktopBackend({ home, probe })).toEqual({ kind: 'spawn' })
    // Nothing to probe means no network work on the ordinary path.
    expect(probe).not.toHaveBeenCalled()
  })

  it('adopts a live Host that answers on its advertised URL', async () => {
    const home = await makeHome()
    // A live pid that is not ours, so the lease reads as a peer's.
    await advertise(home, process.pid === 1 ? 2 : process.pid, 'http://127.0.0.1:3080')
    const plan = await planDesktopBackend({
      home,
      ownPid: -1,
      probe: async () => true,
    })
    expect(plan).toEqual({ kind: 'attach', url: 'http://127.0.0.1:3080' })
  })

  it('starts its own Host when the advertised Host no longer answers', async () => {
    const home = await makeHome()
    await advertise(home, process.pid === 1 ? 2 : process.pid, 'http://127.0.0.1:3080')
    // A crashed Host must not block the shell: a stale record is not an owner.
    expect(await planDesktopBackend({ home, ownPid: -1, probe: async () => false }))
      .toEqual({ kind: 'spawn' })
  })

  it('ignores a lease whose process is gone, without probing it', async () => {
    const home = await makeHome()
    await advertise(home, 2 ** 30, 'http://127.0.0.1:3080')
    const probe = vi.fn(async () => true)
    expect(await planDesktopBackend({ home, ownPid: -1, probe })).toEqual({ kind: 'spawn' })
    expect(probe).not.toHaveBeenCalled()
  })

  it('starts its own Host when the incumbent advertises no URL', async () => {
    const home = await makeHome()
    // A carrier-only Host has no HTTP surface, so it cannot be rendered here.
    await advertise(home, process.pid === 1 ? 2 : process.pid)
    const probe = vi.fn(async () => true)
    expect(await planDesktopBackend({ home, ownPid: -1, probe })).toEqual({ kind: 'spawn' })
    expect(probe).not.toHaveBeenCalled()
  })

  it('never adopts the shell\'s own lease', async () => {
    const home = await makeHome()
    await advertise(home, 4242, 'http://127.0.0.1:3080')
    const probe = vi.fn(async () => true)
    expect(await planDesktopBackend({ home, ownPid: 4242, probe })).toEqual({ kind: 'spawn' })
    expect(probe).not.toHaveBeenCalled()
  })

  it('starts its own Host when the probe itself fails', async () => {
    const home = await makeHome()
    await advertise(home, process.pid === 1 ? 2 : process.pid, 'http://127.0.0.1:3080')
    expect(await planDesktopBackend({
      home,
      ownPid: -1,
      probe: async () => { throw new Error('connection refused') },
    })).toEqual({ kind: 'spawn' })
  })
})
