// The reader's choice to let the browser extension reach the app: stored in the Aeven home, on by
// default, and followed by registering the host or removing its registrations.

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExtensionIntegration, ExtensionLinks } from '../src/browser-extension.ts'

let home: string
let pipes = 0

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'avn-ext-choice-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

/**
 * An integration over a socket of its own, recording what it registers and removes.
 * @returns the integration and its record.
 */
function integration(): { calls: string[]; choice: ExtensionIntegration } {
  const calls: string[] = []
  pipes += 1
  const choice = new ExtensionIntegration(home, {
    registry: new ExtensionLinks(),
    socket: process.platform === 'win32' ? `\\\\.\\pipe\\avn-ext-choice-${String(process.pid)}-${String(pipes)}` : join(home, 'choice.sock'),
    install: async () => { calls.push('install') },
    remove: async () => { calls.push('remove') },
  })
  return { calls, choice }
}

describe('the choice to let the extension connect', () => {
  it('is on until the reader turns it off, and registers the host when it starts', async () => {
    const { calls, choice } = integration()
    expect(choice.enabled).toBe(true)
    await choice.start()
    expect(calls).toEqual(['install'])
    choice.close()
  })

  it('removes the registrations when turned off, and a later launch registers nothing', async () => {
    const { calls, choice } = integration()
    await choice.start()
    await choice.setEnabled(false)
    expect(calls).toEqual(['install', 'remove'])
    expect(JSON.parse(await readFile(join(home, 'desktop', 'browser-extension.json'), 'utf8'))).toEqual({ enabled: false })

    const next = integration()
    expect(next.choice.enabled).toBe(false)
    await next.choice.start()
    expect(next.calls).toEqual([])
  })

  it('registers the host again when turned back on', async () => {
    const { calls, choice } = integration()
    await choice.setEnabled(false)
    await choice.setEnabled(true)
    expect(calls).toEqual(['remove', 'install'])
    expect(choice.enabled).toBe(true)
    choice.close()
  })

  it('applies changes in the order they were asked for', async () => {
    const { calls, choice } = integration()
    await Promise.all([choice.start(), choice.setEnabled(false), choice.setEnabled(true), choice.setEnabled(false)])
    expect(calls).toEqual(['install', 'remove', 'install', 'remove'])
    expect(choice.enabled).toBe(false)
  })
})
