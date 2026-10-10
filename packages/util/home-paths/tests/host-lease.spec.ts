import { createServer, type Server } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  advertiseHostUrl,
  clearHostLease,
  HOST_LEASE_FILE,
  HOST_LEASE_VERSION,
  hostLeasePath,
  isHostProcessAlive,
  liveHostLease,
  probeHostUrl,
  readHostLease,
  writeHostLease,
} from '@aeven/home-paths'

const homes: string[] = []
const servers: Server[] = []

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'avn-lease-'))
  homes.push(home)
  return home
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.close(() => { resolve() })
  })))
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

/** A pid that no process can hold, so liveness must report absent. */
const DEAD_PID = 2 ** 30

it('round-trips a lease owner-only and reports liveness truthfully', async () => {
  const home = await makeHome()
  await writeHostLease(home, {
    version: HOST_LEASE_VERSION,
    pid: process.pid,
    startedAt: '2026-09-14T00:00:00.000Z',
    url: 'http://127.0.0.1:3080/?token=secret',
  })

  const read = await readHostLease(home)
  expect(read?.pid).toBe(process.pid)
  expect(read?.url).toBe('http://127.0.0.1:3080/?token=secret')
  // The record carries a live launch token, so it must never be world-readable.
  expect((await stat(hostLeasePath(home))).mode & 0o077).toBe(0)

  expect(isHostProcessAlive(process.pid)).toBe(true)
  expect(isHostProcessAlive(DEAD_PID)).toBe(false)
  expect(isHostProcessAlive(0)).toBe(false)
  expect(isHostProcessAlive(-1)).toBe(false)
})

it('treats a missing, corrupt, or future-versioned lease as unclaimed', async () => {
  const home = await makeHome()
  expect(await readHostLease(home)).toBeUndefined()

  await mkdir(join(home, 'runtime'), { recursive: true })
  await writeFile(hostLeasePath(home), '{ not json', 'utf8')
  expect(await readHostLease(home)).toBeUndefined()

  await writeFile(hostLeasePath(home), JSON.stringify({ version: 99, pid: 1, startedAt: 'x' }), 'utf8')
  expect(await readHostLease(home)).toBeUndefined()

  await writeFile(hostLeasePath(home), JSON.stringify({ version: HOST_LEASE_VERSION, pid: 0, startedAt: 'x' }), 'utf8')
  expect(await readHostLease(home)).toBeUndefined()

  // Valid JSON that is not an object at all, and an object whose optional url
  // carries the wrong type: the shape guard is all that stands between these
  // and a consumer reading `.pid` off null.
  await writeFile(hostLeasePath(home), 'null', 'utf8')
  expect(await readHostLease(home)).toBeUndefined()
  await writeFile(hostLeasePath(home), JSON.stringify({ version: HOST_LEASE_VERSION, pid: 1, startedAt: 'x', url: 7 }), 'utf8')
  expect(await readHostLease(home)).toBeUndefined()
})

it('reports no live Host on an unclaimed home', async () => {
  const home = await makeHome()
  // The absent-lease path: nothing to judge and nothing to take over.
  expect(await liveHostLease(home)).toBeUndefined()
})

it('reports a live Host and leaves replacement of a dead advertisement to its next owner', async () => {
  const home = await makeHome()
  await writeHostLease(home, {
    version: HOST_LEASE_VERSION,
    pid: process.pid,
    startedAt: '2026-09-14T00:00:00.000Z',
  })
  expect((await liveHostLease(home))?.pid).toBe(process.pid)

  await writeHostLease(home, {
    version: HOST_LEASE_VERSION,
    pid: DEAD_PID,
    startedAt: '2026-09-14T00:00:00.000Z',
  })
  expect(await liveHostLease(home)).toBeUndefined()
  expect((await readHostLease(home))?.pid).toBe(DEAD_PID)
})

it('never lets a loser release or rewrite the winner\'s advertisement', async () => {
  const home = await makeHome()
  await writeHostLease(home, {
    version: HOST_LEASE_VERSION,
    pid: process.pid,
    startedAt: '2026-09-14T00:00:00.000Z',
  })

  await clearHostLease(home, DEAD_PID)
  await expect(advertiseHostUrl(home, DEAD_PID, 'http://127.0.0.1:9999/?token=other')).rejects.toThrow('startup ownership')
  expect((await readHostLease(home))?.pid).toBe(process.pid)
  expect((await readHostLease(home))?.url).toBeUndefined()

  await advertiseHostUrl(home, process.pid, 'http://127.0.0.1:3080/?token=mine')
  expect((await readHostLease(home))?.url).toBe('http://127.0.0.1:3080/?token=mine')

  await clearHostLease(home, process.pid)
  expect(await readHostLease(home)).toBeUndefined()
  expect(await readFile(hostLeasePath(home), 'utf8').catch(() => undefined)).toBeUndefined()
})

it('probes an advertised URL and treats silence as gone', async () => {
  const server = createServer((_request, response) => { response.writeHead(200).end('ok') })
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve() }) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  expect(await probeHostUrl(`http://127.0.0.1:${String(port)}/`)).toBe(true)
  // A closed port must not be mistaken for a live Host, or a stale lease would
  // block the next start instead of being taken over.
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  expect(await probeHostUrl(`http://127.0.0.1:${String(port)}/`, 300)).toBe(false)
  expect(await probeHostUrl('http://127.0.0.1:1/', 300)).toBe(false)
})

it('keeps the lease inside the runtime directory of its home', async () => {
  expect(HOST_LEASE_FILE).toBe('runtime/host.json')
  expect(hostLeasePath('/tmp/home')).toBe('/tmp/home/runtime/host.json')
})

/**
 * Stale-lease removal is best-effort, and the disposal helpers swallow their
 * own write failures: a Host that lost a race, or that cannot write at all,
 * must still start. Forcing that failure takes a record that can neither be
 * unlinked nor rewritten — a read-only file inside a read-only directory —
 * which only a non-root POSIX process can be denied (as root both succeed and
 * the failure path is unreachable).
 */
it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('keeps a usable answer when a stale lease cannot be removed or rewritten', async () => {
  const home = await makeHome()
  const runtime = join(home, 'runtime')
  await mkdir(runtime, { recursive: true })
  await writeHostLease(home, {
    version: HOST_LEASE_VERSION,
    pid: DEAD_PID,
    startedAt: '2026-09-14T00:00:00.000Z',
  })
  await chmod(hostLeasePath(home), 0o400)
  await chmod(runtime, 0o500)
  try {
    // The stale advertisement is still rejected, and the failed removal does
    // not surface as a rejection the next start would have to handle.
    await expect(liveHostLease(home)).resolves.toBeUndefined()
    // The same for the two disposal helpers: neither may throw because the
    // medium refused the write.
    await expect(clearHostLease(home, DEAD_PID)).resolves.toBeUndefined()
    await expect(advertiseHostUrl(home, DEAD_PID, 'http://127.0.0.1:9999/?token=x')).rejects.toThrow()
  } finally {
    await chmod(runtime, 0o700)
    await chmod(hostLeasePath(home), 0o600)
  }
  // The record survived the failed attempts untouched: no url was attached.
  expect(await readHostLease(home)).toEqual({
    version: HOST_LEASE_VERSION,
    pid: DEAD_PID,
    startedAt: '2026-09-14T00:00:00.000Z',
  })
})
