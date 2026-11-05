/**
 * Account sync Consumer for settings: every namespace registered with `reach: 'account'`, such as theme,
 * language, and default model, is the same on every device of the account. Device namespaces (ports, paths,
 * provider keys, device support) stay on the device.
 * @module @aeven/settings-sync
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Map as YMap, Transaction, YMapEvent } from 'yjs'
import type {} from '@aeven/settings'
import type { SyncDocument } from '@aeven/sync'

export const name = 'settings-sync'

export const inject = ['sync', 'settings']

const DOCUMENT = 'settings/account'

/** The registered account namespaces. */
function accountNamespaces(ctx: Context): Set<string> {
  return new Set(ctx.settings.describe().filter(descriptor => descriptor.reach === 'account').map(descriptor => descriptor.ns as string))
}

/**
 * The raw user section of each account namespace that holds one, as `owner` keeps it: the account's own sections on
 * a provider that keeps them, otherwise the Host document's sections.
 */
async function userSections(ctx: Context, owner: string): Promise<Map<string, unknown>> {
  const sections = new Map<string, unknown>()
  for (const descriptor of await ctx.settings.describeFor(owner, { redactSecrets: true })) {
    if (descriptor.reach === 'account' && descriptor.user !== undefined) sections.set(descriptor.ns, descriptor.user)
  }
  return sections
}

/**
 * Mirror the account namespaces of each account sync serves on this Host.
 * @param ctx - Host context with sync and settings.
 */
export function apply(ctx: Context): void {
  const open = new Map<string, Promise<SyncDocument | undefined>>()
  const perAccount = (): boolean => ctx.settings.accountSections

  const publish = async (owner: string, map: YMap<unknown>): Promise<void> => {
    const sections = await userSections(ctx, owner)
    map.doc?.transact(() => {
      for (const [ns, section] of sections) {
        if (JSON.stringify(map.get(ns)) !== JSON.stringify(section)) map.set(ns, section)
      }
    })
  }

  const take = async (owner: string, map: YMap<unknown>, keys: Iterable<string>): Promise<void> => {
    const namespaces = accountNamespaces(ctx)
    const current = await userSections(ctx, owner)
    for (const ns of keys) {
      const section = map.get(ns)
      if (!namespaces.has(ns) || typeof section !== 'object' || section === null) continue
      if (JSON.stringify(current.get(ns)) === JSON.stringify(section)) continue
      const write = perAccount() ? ctx.settings.writeFor(owner, ns, 'replace', section) : ctx.settings.replace(ns, section)
      write.catch((error: unknown) => {
        ctx.logger.warn(`settings sync: applying ${ns} failed: ${String(error)}`)
      })
    }
  }

  const failed = (error: unknown): void => {
    ctx.logger.warn(`settings sync: mirroring the account's settings failed: ${String(error)}`)
  }

  const attach = (owner: string): void => {
    const state = ctx.sync.status(owner).state
    if (open.has(owner) || state === 'disabled' || state === 'starting') return
    const opening = ctx.sync.openDocument(owner, DOCUMENT).then((handle) => {
      const map = handle.doc.getMap<unknown>('sections')
      // An empty document is seeded by this device; otherwise the account's settings win over this device's.
      void (map.size === 0 ? publish(owner, map) : take(owner, map, map.keys())).catch(failed)
      map.observe((event: YMapEvent<unknown>, transaction: Transaction) => {
        if (!transaction.local) void take(owner, map, event.keysChanged).catch(failed)
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
  // The account's documents started over under a new key; the next attach opens and seeds the document anew.
  ctx.on('sync/reset', (owner) => {
    const opening = open.get(owner)
    open.delete(owner)
    void opening?.then(handle => handle?.close())
  })
  const republish = (owner: string): void => {
    void open.get(owner)?.then((handle) => {
      if (handle !== undefined) return publish(owner, handle.doc.getMap<unknown>('sections'))
    }).catch(failed)
  }
  // One Host document serves every account: a change to it is every synced account's change.
  ctx.on('settings/document-updated', (ns) => {
    if (perAccount() || !accountNamespaces(ctx).has(ns)) return
    for (const owner of open.keys()) republish(owner)
  })
  ctx.on('settings/account-updated', (owner) => { if (perAccount()) republish(owner) })
  ctx.effect(() => async () => {
    for (const opening of open.values()) (await opening)?.close()
    open.clear()
  }, 'settings-sync.documents')
}
