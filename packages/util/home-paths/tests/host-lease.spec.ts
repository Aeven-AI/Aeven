import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
} from '@deepseek-ai/dsh-home-paths'

const homes: string[] = []
const servers: Server[] = []

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-lease-'))
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
})

it('reports a live Host and silently takes over a dead one', async () => {
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
  // A crashed Host leaves no advertisement behind to mislead the next start.
  expect(await readHostLease(home)).toBeUndefined()
})

it('never lets a loser release or rewrite the winner\'s advertisement', async () => {
  const home = await makeHome()
  await writeHostLease(home, {
    version: HOST_LEASE_VERSION,
    pid: process.pid,
    startedAt: '2026-09-14T00:00:00.000Z',
  })

  await clearHostLease(home, DEAD_PID)
  await advertiseHostUrl(home, DEAD_PID, 'http://127.0.0.1:9999/?token=other')
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
