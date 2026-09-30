/**
 * ui-job plugin halves: the browser entry's dictionary, its header-slot
 * registration against the real SlotRegistry (with fiber teardown proving
 * removal — HMR safety), the jobs face that registration binds, and the inert
 * node entry.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@aeven/client-ui-renderer/client'
import { stubSettingsScope } from '@aeven/client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@aeven/client-locale/client'
import type { SessionId } from '@aeven/session/types'
import { apply, inject } from '../src/client/index.ts'
import type { JobListInjected } from '../src/client/JobListAction.tsx'
import { apply as applyNode } from '../src/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

const SESSION = 'session' as SessionId

/** Slot ledger reader: entry ids currently registered in the header list. */
function headerEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots
    .entries('conversation.session.header.actions')
    .map(entry => entry.options.id)
}

/** The client jobs service a real host composition installs, stubbed to record its calls. */
function jobsService() {
  return {
    state: { getSnapshot: () => ({ rows: {}, observed: {} }), subscribe: () => () => {} },
    watchRows: vi.fn(() => vi.fn()),
    observe: vi.fn(() => vi.fn()),
    kill: vi.fn(async () => ({ ok: true })),
    dismiss: vi.fn(async () => ({ ok: true })),
  }
}

/** Boot the browser half over a real slot tree that declares the header list. */
async function bench(): Promise<{
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  jobs: ReturnType<typeof jobsService>
}> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  const jobs = jobsService()
  ctx.provide('jobs', jobs as never)
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  // These specs assert the shipped Chinese copy. There is no jsdom `window` in
  // this lane, so browser-language detection never runs and the locale comes
  // from FALLBACK_LOCALE (en): state the asserted locale explicitly.
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, jobs }
}

/** The business face the header action's registration binds. */
function injectedFace(ctx: Context): JobListInjected {
  const entry = ctx.slots.entries('conversation.session.header.actions')[0]
  const face = entry?.inject?.() as JobListInjected | undefined
  if (face === undefined) throw new Error('the job list registered no inject face')
  return face
}

describe('ui-job browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['jobs', 'slots', 'locale'])
  })

  it('registers the header action, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(headerEntryIds(ctx)).toContain('job-list')
    await fiber.dispose()
    expect(headerEntryIds(ctx)).not.toContain('job-list')
  })

  it('binds the header action to the client jobs service', async () => {
    const { ctx, jobs } = await bench()
    const face = injectedFace(ctx)

    expect(face.hooks.jobs).toBe(jobs.state)
    expect(typeof face.watchRows(SESSION)).toBe('function')
    expect(jobs.watchRows).toHaveBeenCalledWith(SESSION)

    expect(typeof face.observe(SESSION, 'bash-1' as never)).toBe('function')
    expect(jobs.observe).toHaveBeenCalledWith(SESSION, 'bash-1')

    await expect(face.killJob(SESSION, 'bash-1')).resolves.toBe(true)
    expect(jobs.kill).toHaveBeenCalledWith(SESSION, 'bash-1')
    await expect(face.removeJob(SESSION, 'bash-1')).resolves.toBe(true)
    expect(jobs.dismiss).toHaveBeenCalledWith(SESSION, 'bash-1')
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('list.aria')).toBe(zh['list.aria'])
    ctx.locale.setLocale('en')
    expect(translate('list.aria')).toBe(en['list.aria'])

    // Withdrawn dictionaries leave the key unresolved rather than translated.
    await fiber.dispose()
    expect(translate('list.aria')).not.toBe(en['list.aria'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-job node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(applyNode).not.toThrow()
  })
})
