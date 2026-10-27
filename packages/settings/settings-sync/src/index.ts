/**
 * Account sync Consumer for settings: the configured account-level namespaces of `settings.yaml`, such as theme,
 * language, and default model, are the same on every device of the account. Device facts (ports, paths, provider
 * keys, device support) stay on the device because they are not listed.
 * @module @aeven/settings-sync
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Map as YMap, Transaction, YMapEvent } from 'yjs'
import type {} from '@aeven/settings'
import type { SyncDocument } from '@aeven/sync'

export const name = 'settings-sync'

export const inject = ['sync', 'settings']

/** Plugin configuration. */
export interface Config {
  /** Settings namespaces that belong to the account rather than to one device. */
  namespaces: string[]
}

export const Config: z<Config> = z.object({
  namespaces: z.array(z.string()).default(['ui-theme', 'locale', 'ui-chat', 'ui-conversation', 'agent-default-model', 'media', 'media-video']),
})

const DOCUMENT = 'settings/account'

/** The raw user section of each listed namespace that holds one. */
function userSections(ctx: Context, namespaces: ReadonlySet<string>): Map<string, unknown> {
  const sections = new Map<string, unknown>()
  for (const descriptor of ctx.settings.describe({ redactSecrets: true })) {
    if (namespaces.has(descriptor.ns) && descriptor.user !== undefined) sections.set(descriptor.ns, descriptor.user)
  }
  return sections
}

/**
 * Mirror the listed namespaces of each account sync serves on this Host.
 * @param ctx - Host context with sync and settings.
 * @param config - the account-level namespaces.
 */
export function apply(ctx: Context, config: Config): void {
  const namespaces = new Set(config.namespaces)
  const open = new Map<string, Promise<SyncDocument | undefined>>()

  const publish = (map: YMap<unknown>): void => {
    const sections = userSections(ctx, namespaces)
    map.doc?.transact(() => {
      for (const [ns, section] of sections) {
        if (JSON.stringify(map.get(ns)) !== JSON.stringify(section)) map.set(ns, section)
      }
    })
  }

  const take = (map: YMap<unknown>, keys: Iterable<string>): void => {
    const registered = new Set(ctx.settings.describe().map(descriptor => descriptor.ns as string))
    for (const ns of keys) {
      const section = map.get(ns)
      if (!namespaces.has(ns) || !registered.has(ns) || typeof section !== 'object' || section === null) continue
      const current = userSections(ctx, new Set([ns])).get(ns)
      if (JSON.stringify(current) === JSON.stringify(section)) continue
      ctx.settings.replace(ns, section).catch((error: unknown) => {
        ctx.logger.warn(`settings sync: applying ${ns} failed: ${String(error)}`)
      })
    }
  }

  const attach = (owner: string): void => {
    const state = ctx.sync.status(owner).state
    if (open.has(owner) || state === 'unenrolled' || state === 'joining') return
    const opening = ctx.sync.openDocument(owner, DOCUMENT).then((handle) => {
      const map = handle.doc.getMap<unknown>('sections')
      // An empty document is seeded by this device; otherwise the account's settings win over this device's.
      if (map.size === 0) publish(map)
      else take(map, map.keys())
      map.observe((event: YMapEvent<unknown>, transaction: Transaction) => {
        if (!transaction.local) take(map, event.keysChanged)
      })
      return handle
    }, (error: unknown) => {
      open.delete(owner)
      ctx.logger.warn(`settings sync: opening the account's settings failed: ${String(error)}`)
      return undefined
    })
    open.set(owner, opening)
  }

  ctx.on('sync/status', attach)
  ctx.on('settings/document-updated', (ns) => {
    if (!namespaces.has(ns)) return
    for (const opening of open.values()) {
      void opening.then((handle) => { if (handle !== undefined) publish(handle.doc.getMap<unknown>('sections')) })
    }
  })
  ctx.effect(() => async () => {
    for (const opening of open.values()) (await opening)?.close()
    open.clear()
  }, 'settings-sync.documents')
}
