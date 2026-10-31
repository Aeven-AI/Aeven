/** The built daemon entry: its address announcement, the token gate, and shutdown when stdin closes. */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const ENTRY = fileURLToPath(new URL('../dist/aeven/main.js', import.meta.url))

/** One spawned daemon and the temporary Aeven-owned home it writes to. */
interface Spawned {
  child: ChildProcess
  home: string
  token: string
}

const spawned: Spawned[] = []

/** Start the built entry and read the one line it announces on stdout. */
async function launch(): Promise<{ child: ChildProcess, address: string, token: string, home: string }> {
  const home = await mkdtemp(join(tmpdir(), 'aeven-telegram-mcp-'))
  const token = 'spec-token'
  const child = spawn(process.execPath, [ENTRY], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '',
      TELEGRAM_MCP_TOKEN: token, TELEGRAM_API_ID: '123456', TELEGRAM_API_HASH: 'spec-api-hash', TELEGRAM_MCP_HOME: home,
    },
  })
  spawned.push({ child, home, token })
  const address = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('the daemon announced no address')) }, 20_000)
    child.stdout!.on('data', (chunk: Buffer) => {
      const match = /\{"listening":"(127\.0\.0\.1:\d+)"\}/.exec(chunk.toString('utf8'))
      if (match === null) return
      clearTimeout(timer)
      resolve(match[1]!)
    })
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the daemon exited with ${String(code)}`)) })
  })
  return { child, address, token, home }
}

afterEach(async () => {
  for (const { child, home } of spawned.splice(0)) {
    child.kill('SIGKILL')
    await rm(home, { recursive: true, force: true })
  }
})

describe('telegram daemon entry', () => {
  // The subject is the built entry, so a checkout without build output has
  // nothing to launch; the build lane covers this case.
  it.skipIf(!existsSync(ENTRY))(
    'announces a loopback address, answers status only for its token, and stops when stdin closes', async () => {
    const { child, address, token } = await launch()

    const unauthorized = await fetch(`http://${address}/status`)
    expect(unauthorized.status).toBe(401)

    const status = await fetch(`http://${address}/status`, { headers: { Authorization: `Bearer ${token}` } })
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({ state: 'login' })

    const exited = new Promise<number | null>((resolve) => { child.once('exit', (code) => { resolve(code) }) })
    child.stdin!.end()
    expect(await exited).toBe(0)
  }, 30_000)
})
