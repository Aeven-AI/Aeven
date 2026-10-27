/**
 * Account-level settings across two devices: a listed namespace changed on one device lands on the other, an
 * unlisted namespace stays on its device, the first device seeds an empty account document, and a joining
 * device takes the account's settings instead of its own.
 */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemorySettings } from '../../settings/tests/memory.ts'
import { MemorySyncNetwork, type MemorySyncDevice } from '../../../sync/sync/tests/memory.ts'
import * as plugin from '../src/index.ts'

const OWNER = 'owner-1'
const Theme = z.object({ preference: z.union(['light', 'dark']).default('light') })
const Device = z.object({ enabled: z.boolean().default(false) })
const disposers: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose() })

async function host(device: MemorySyncDevice, doc: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context()
  ctx.provide('sync', device.asSync())
  const settings = ctx.plugin(MemorySettings, { doc })
  await settings
  const registrations = ctx.plugin({
    name: 'registrations',
    inject: ['settings'],
    apply: (scope: Context) => {
      scope.settings.register('ui-theme', Theme)
      scope.settings.register('device', Device)
    },
  })
  await registrations
  const fiber = ctx.plugin(plugin, { namespaces: ['ui-theme', 'not-registered'] })
  await fiber
  disposers.push(() => fiber.dispose(), () => registrations.dispose(), () => settings.dispose())
  return ctx
}

const theme = (ctx: Context): unknown => ctx.settings.describe().find(descriptor => descriptor.ns === 'ui-theme')?.value

describe('settings sync', () => {
  it('carries a listed namespace between devices and keeps device settings home', async () => {
    const network = new MemorySyncNetwork()
    const a = await host(network.device(), { 'ui-theme': { preference: 'dark' } })
    const b = await host(network.device())
    b.emit('sync/status', OWNER)
    a.emit('sync/status', OWNER)
    await vi.waitFor(() => { expect(theme(b)).toEqual({ preference: 'dark' }) })
    await b.settings.update('ui-theme', { preference: 'light' })
    await vi.waitFor(() => { expect(theme(a)).toEqual({ preference: 'light' }) })
    await a.settings.update('device', { enabled: true })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(b.settings.describe().find(descriptor => descriptor.ns === 'device')?.value).toEqual({ enabled: false })
  })

  it('gives a joining device the account settings instead of its own', async () => {
    const network = new MemorySyncNetwork()
    const late = network.device()
    const doc = await late.asSync().openDocument(OWNER, 'settings/account')
    doc.doc.getMap('sections').set('ui-theme', { preference: 'dark' })
    doc.doc.getMap('sections').set('not-registered', { x: 1 })
    doc.doc.getMap('sections').set('device', { enabled: true })
    const b = await host(late, { 'ui-theme': { preference: 'light' } })
    b.emit('sync/status', OWNER)
    await vi.waitFor(() => { expect(theme(b)).toEqual({ preference: 'dark' }) })
    const update = vi.spyOn(b.settings, 'replace')
    const other = await network.device().asSync().openDocument(OWNER, 'settings/account')
    other.doc.getMap('sections').set('ui-theme', { preference: 'dark' })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(update).not.toHaveBeenCalled()
  })

  it('reports a synced section this device refuses, and skips values that are not sections', async () => {
    const network = new MemorySyncNetwork()
    const writer = network.device()
    const b = await host(network.device())
    b.emit('sync/status', OWNER)
    await vi.waitFor(async () => { expect(await b.sync.openDocument(OWNER, 'settings/account')).toBeDefined() })
    const warn = vi.spyOn(b.logger, 'warn').mockImplementation(() => {})
    const doc = await writer.asSync().openDocument(OWNER, 'settings/account')
    doc.doc.getMap('sections').set('ui-theme', 'not a section')
    doc.doc.getMap('sections').set('ui-theme', { preference: 'purple' })
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('applying ui-theme failed')) })
  })

  it('ignores an account sync does not serve, and reports a document it cannot open', async () => {
    const network = new MemorySyncNetwork()
    const idle = await host(network.device('unenrolled'))
    idle.emit('sync/status', OWNER)
    const failing = network.device()
    const sync = failing.asSync()
    sync.openDocument = () => Promise.reject(new Error('locked'))
    const ctx = new Context()
    ctx.provide('sync', sync)
    const settings = ctx.plugin(MemorySettings, {})
    await settings
    const fiber = ctx.plugin(plugin, { namespaces: ['ui-theme'] })
    await fiber
    disposers.push(() => fiber.dispose(), () => settings.dispose())
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.emit('sync/status', OWNER)
    ctx.emit('settings/document-updated', 'ui-theme' as never, 1)
    ctx.emit('settings/document-updated', 'device' as never, 1)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('locked')) })
  })
})
