// The reader's choice to let the browser extension reach the app: stored in the Aeven home, on by
// default, and followed by serving the extension's WebSocket or closing it.

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { EXTENSION_IDS, ExtensionIntegration, ExtensionLinks } from '../src/browser-extension.ts'

let home: string
let port: number

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'avn-ext-choice-'))
  // A port that was free a moment ago, for the integration to serve on.
  const probe = createServer()
  await new Promise<void>((resolve) => { probe.listen(0, '127.0.0.1', resolve) })
  port = (probe.address() as { port: number }).port
  await new Promise<void>((resolve) => { probe.close(() => { resolve() }) })
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

/**
 * An integration serving on the test's port.
 * @returns the integration.
 */
function integration(): ExtensionIntegration {
  return new ExtensionIntegration(home, { registry: new ExtensionLinks(), ports: [port], pair: async () => undefined })
}

/**
 * Whether the extension's server answers on the test's port with a challenge.
 * @returns true when it does, false when the connection is refused.
 */
async function serving(): Promise<boolean> {
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/`, { origin: `chrome-extension://${EXTENSION_IDS[0]}` })
  const answered = await new Promise<boolean>((resolve) => {
    socket.once('message', () => { resolve(true) })
    socket.once('error', () => { resolve(false) })
  })
  socket.terminate()
  return answered
}

describe('the choice to let the extension connect', () => {
  it('is on until the reader turns it off, and serves the extension when it starts', async () => {
    const choice = integration()
    expect(choice.enabled).toBe(true)
    await choice.start()
    expect(await serving()).toBe(true)
    choice.close()
  })

  it('stops serving when turned off, and a later launch serves nothing', async () => {
    const choice = integration()
    await choice.start()
    await choice.setEnabled(false)
    expect(await serving()).toBe(false)
    expect(JSON.parse(await readFile(join(home, 'desktop', 'browser-extension.json'), 'utf8'))).toEqual({ enabled: false })

    const next = integration()
    expect(next.enabled).toBe(false)
    await next.start()
    expect(await serving()).toBe(false)
  })

  it('serves again when turned back on', async () => {
    const choice = integration()
    await choice.setEnabled(false)
    await choice.setEnabled(true)
    expect(await serving()).toBe(true)
    expect(choice.enabled).toBe(true)
    choice.close()
  })

  it('applies changes in the order they were asked for', async () => {
    const choice = integration()
    await Promise.all([choice.start(), choice.setEnabled(false), choice.setEnabled(true), choice.setEnabled(false)])
    expect(choice.enabled).toBe(false)
    expect(await serving()).toBe(false)
  })

  it('keeps one pairing secret across launches', async () => {
    const choice = integration()
    await choice.start()
    choice.close()
    const secret = await readFile(join(home, 'desktop', 'browser-extension-secret'), 'utf8')
    expect(secret).toMatch(/^[\da-f]{64}\n$/)
    const next = integration()
    await next.start()
    next.close()
    expect(await readFile(join(home, 'desktop', 'browser-extension-secret'), 'utf8')).toBe(secret)
  })
})
