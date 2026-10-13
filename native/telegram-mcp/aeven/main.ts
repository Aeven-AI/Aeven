#!/usr/bin/env node
/**
 * Executable entry of the Telegram connector daemon.
 *
 * stdout carries exactly one JSON line — the bound loopback address — that the
 * connector reads; everything teleproto and the upstream MCP server log belongs
 * on stderr, so console output is redirected before those modules load.
 */

import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'

console.log = (...args: unknown[]) => { console.error(...args) }
console.info = (...args: unknown[]) => { console.error(...args) }
console.debug = () => {}

const { config } = await import('../source/src/config.ts')
const { createTelegramServer } = await import('./server.ts')
const { startDaemon } = await import('./daemon.ts')
const { TeleprotoLogin } = await import('./teleproto.ts')

const token = process.env['TELEGRAM_MCP_TOKEN']
if (token === undefined || token === '') throw new Error('TELEGRAM_MCP_TOKEN is required')
if (config.apiId === 0 || config.apiHash === '') throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH are required')

const home = dirname(config.sessionFile)
await mkdir(home, { recursive: true, mode: 0o700 })
const login = new TeleprotoLogin({
  apiId: config.apiId, apiHash: config.apiHash,
  sessionFile: config.sessionFile, identityFile: join(home, 'identity.json'),
})
const daemon = await startDaemon({ token, login, server: createTelegramServer })
process.stdout.write(`${JSON.stringify({ listening: daemon.address })}\n`)

let stopping = false
const shutdown = (): void => {
  if (stopping) return
  stopping = true
  void daemon.close().then(() => { process.exit(0) })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
// The connector holds stdin open for the daemon's lifetime; EOF means it exited.
createInterface({ input: process.stdin }).on('close', shutdown)
