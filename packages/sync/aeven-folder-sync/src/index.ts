/**
 * The account's Aeven folder: the directory where Aeven keeps the files it makes for the user, such as decks, CVs,
 * films, and their previews, kept the same on every device of the account through file sync.
 *
 * Without `perAccount` the folder belongs to one account of this device: the first to attach records itself in the
 * folder's `.aeven-account` file, and the device's other accounts get no Aeven folder here, so one account's files
 * never travel with another's.
 *
 * Each device shares its Aeven folder under one folder id derived from the account, so the account's devices and its
 * encrypted file cloud copy all join the same folder without coordinating. Each device also publishes where its Aeven
 * folder lives in the account's `aeven-folder/paths` document, so a path one device wrote, such as an image a reply
 * shows, resolves to the same file on another device with {@link AevenFolder.localPath}. The model's runtime context
 * names the folder as the place for the files it makes for the user.
 *
 * A Host that serves an account's readers without workspace file sync, such as Aeven Cloud, sets `announcePeer`: it
 * then lists itself, marked hosted, in the account's `file-sync/peers` document and shares with the devices listed
 * there, so its copy of the folder serves the account's readers while every desktop is offline. It does so only while
 * it holds the account key: the relay holds it, or the user unlocked a passkey-protected account there.
 * @module @aeven/aeven-folder-sync
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Map as YMap, Transaction, YMapEvent } from 'yjs'
import { brandString } from '@aeven/brand'
import type {} from '@aeven/file-sync'
import type {} from '@aeven/host-account-data'
import type { FileSyncFolderId, FileSyncPeerId } from '@aeven/file-sync'
import type { SyncDocument } from '@aeven/sync'
import type {} from '@aeven/sync'
import type {} from '@aeven/system-prompt'
import type {} from '@aeven/agent'
import type {} from '@aeven/working-directory'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The account's Aeven folder on this device. */
    aevenFolder: AevenFolder
  }
}

/** The document mapping each device of the account to the absolute path of its Aeven folder. */
const PATHS = 'aeven-folder/paths'

/** The document mapping each device of the account to its file transport peer id. */
const PEERS = 'file-sync/peers'

/** One device's file transport identity as the peers document holds it. */
interface SyncedPeer {
  peer: string
  /** The device is a Host serving the account's readers, which listed itself while it held the account key. */
  hosted?: true
}

/** The file inside a shared Aeven folder naming the one account it belongs to. */
const OWNER_FILE = '.aeven-account'

/** One device's Aeven folder as the paths document holds it. */
interface SyncedPath {
  /** Absolute directory on that device, in that device's path syntax. */
  path: string
}

/** Plugin configuration. */
export interface Config {
  /** Absolute directory of the Aeven folder on this device, such as `~/Documents/Aeven` expanded. */
  path: string
  /**
   * Whether each account keeps its own folder at `<path>/<account>` (default false: `path` belongs to the first
   * account of this device that attaches, and the others get none). A Host serving several accounts sets true.
   */
  perAccount: boolean
  /**
   * Whether this device lists itself as a hosted peer in the account's `file-sync/peers` document and shares the
   * folder with the devices listed there (default false). For a Host serving the account's readers that runs no
   * workspace file sync, which otherwise owns that document.
   */
  announcePeer: boolean
  /**
   * Whether the model's runtime context names the folder as the place for the files it makes for the user (default
   * true). A Host whose sessions cannot write the folder sets false.
   */
  advertise: boolean
}

/**
 * The folder id every device of an account shares its Aeven folder under: a UUID derived from the account, the form
 * the file cloud accepts.
 * @param owner - the account.
 * @returns the folder id.
 */
export function aevenFolderId(owner: string): FileSyncFolderId {
  const hex = createHash('sha256').update(`aeven-folder:${owner}`).digest('hex')
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
  return brandString<FileSyncFolderId>(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`)
}

/** The account's Aeven folder on this device, shared through file sync while it runs. */
export class AevenFolder extends Service {
  /** Deployment configuration; see {@link Config}. */
  static Config: z<Partial<Config>, Config> = z.object({
    path: z.string().required(),
    perAccount: z.boolean().default(false),
    announcePeer: z.boolean().default(false),
    advertise: z.boolean().default(true),
  })

  private readonly documents = new Map<string, Promise<SyncDocument | undefined>>()
  private readonly peerDocuments = new Map<string, Promise<SyncDocument | undefined>>()
  /** Each account's answer from {@link folderNow}, including undefined for an account another one shut out. */
  private readonly claimed = new Map<string, string | undefined>()
  /** Each account's folder once {@link folderOf} settled, for the synchronous runtime context. */
  private readonly settled = new Map<string, string>()

  /**
   * @param ctx - Host context; `sync` and `fileSync` are read optionally.
   * @param config - validated configuration.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'aevenFolder')
    if (!isAbsolute(config.path)) throw new Error(`aeven-folder-sync: path must be absolute: ${config.path}`)
    ctx.on('sync/status', (owner) => {
      void this.attach(owner).then(() => this.config.announcePeer ? this.announce(owner) : undefined)
    })
    ctx.on('sync/reset', (owner) => { void this.reset(owner) })
    // A session with no folder of its own works in a folder inside this one, so the files it makes reach every device.
    ctx.on('working-directory/account-folder', (owner) => {
      try {
        return this.folderNow(owner)
      } catch (error: unknown) {
        this.warn(error)
        return undefined
      }
    })
    ctx.effect(() => async () => {
      for (const opening of [...this.documents.values(), ...this.peerDocuments.values()]) (await opening)?.close()
      this.documents.clear()
      this.peerDocuments.clear()
    }, 'aeven-folder-sync: synced documents')
    // The files Aeven made for the account are part of its data export, and go when a purged account is erased.
    ctx.inject(['accountData'], (scoped) => {
      scoped.effect(() => scoped.accountData.register({
        name: 'Aeven folder',
        export: async (owner, out) => {
          const folder = await this.ownedFolder(owner)
          if (folder !== undefined) await out.directory('Aeven folder', folder, rel => rel === OWNER_FILE || rel.startsWith('.st'))
        },
        erase: async (owner) => {
          const folder = await this.ownedFolder(owner)
          if (folder === undefined) return
          for (const name of await readdir(folder)) await rm(join(folder, name), { recursive: true, force: true })
          this.claimed.delete(owner)
          this.settled.delete(owner)
        },
      }), 'aeven-folder-sync: account data')
    })
    if (config.advertise) ctx.inject(['systemPrompt'], (scoped) => {
      scoped.systemPrompt.context({
        name: 'aeven-folder',
        order: scoped.systemPrompt.getContextOrder('AEVEN_FOLDER'),
        text: (context) => {
          const owner = context.agent?.session.header.owner
          const folder = owner === undefined ? undefined : this.settled.get(owner)
          if (folder === undefined) return ''
          const path = JSON.stringify(folder)
          return `Aeven folder: ${path}. Every device of their account and Aeven Web receive what it holds. Save the files you make for the user in the session workspace, one folder per piece of work, unless they name another place.`
        },
      })
    })
  }

  /**
   * The Aeven folder of an account on this device. Without `perAccount`, the first account to ask claims `path`.
   * @param owner - the account.
   * @returns its absolute directory, or undefined when another account of this device owns the folder.
   */
  folderOf(owner: string): Promise<string | undefined> {
    try {
      return Promise.resolve(this.folderNow(owner))
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * {@link folderOf}, answered synchronously for directory resolution.
   * @param owner - the account.
   * @returns its absolute directory, or undefined when another account of this device owns the folder.
   * @throws when the folder or its owner file cannot be created or read.
   */
  private folderNow(owner: string): string | undefined {
    if (this.claimed.has(owner)) return this.claimed.get(owner)
    const folder = this.config.perAccount ? join(this.config.path, owner) : this.claim(owner)
    this.claimed.set(owner, folder)
    if (folder !== undefined) this.settled.set(owner, folder)
    return folder
  }

  /**
   * The account's Aeven folder on this device when it already has one, without claiming an unowned folder.
   * @param owner - the account.
   * @returns its absolute directory, or undefined when the account has none here.
   */
  private async ownedFolder(owner: string): Promise<string | undefined> {
    if (this.config.perAccount) {
      const folder = join(this.config.path, owner)
      return (await readdir(folder).then(() => true, () => false)) ? folder : undefined
    }
    const named = await readFile(join(this.config.path, OWNER_FILE), 'utf8').catch(() => undefined)
    return named?.trim() === owner ? this.config.path : undefined
  }

  /** Record `owner` as the folder's account unless another already is; the exclusive create settles a race. */
  private claim(owner: string): string | undefined {
    const file = join(this.config.path, OWNER_FILE)
    mkdirSync(this.config.path, { recursive: true })
    try {
      writeFileSync(file, `${owner}\n`, { flag: 'wx' })
    } catch (error: unknown) {
      // An existing file names the account that claimed the folder first.
      if ((error as { code?: unknown } | null)?.code !== 'EEXIST') throw error
    }
    return readFileSync(file, 'utf8').trim() === owner ? this.config.path : undefined
  }

  /**
   * Where a file inside the account's Aeven folder on any of its devices lives on this device.
   * @param owner - the account.
   * @param path - an absolute path as a device of the account wrote it.
   * @returns the same file's absolute path here, or undefined for a path inside no device's Aeven folder.
   */
  async localPath(owner: string, path: string): Promise<string | undefined> {
    const here = await this.folderOf(owner)
    if (here === undefined) return undefined
    const inside = (root: string): string | undefined => {
      const normalized = root.replace(/[/\\]+$/, '')
      for (const separator of ['/', '\\']) {
        if (path.startsWith(`${normalized}${separator}`)) return path.slice(normalized.length + 1)
      }
      return undefined
    }
    const own = relative(here, path)
    if (own !== '' && !own.startsWith('..') && !isAbsolute(own)) return path
    const document = await this.attach(owner)
    if (document === undefined) return undefined
    for (const entry of document.doc.getMap<SyncedPath>(PATHS).values()) {
      const rest = inside(entry.path)
      if (rest === undefined || rest === '') continue
      const segments = rest.split(/[/\\]/)
      if (segments.includes('..')) return undefined
      return join(here, ...segments)
    }
    return undefined
  }

  /** Open the account's paths document, publish this device's folder, and share the folder through file sync. */
  private attach(owner: string): Promise<SyncDocument | undefined> {
    const existing = this.documents.get(owner)
    if (existing !== undefined) return existing
    const sync = this.ctx.get('sync')
    const status = sync?.status(owner)
    const device = status?.device
    if (sync === undefined || status === undefined || device === undefined || status.state === 'disabled' || status.state === 'starting') {
      return Promise.resolve(undefined)
    }
    const opening = sync.openDocument(owner, PATHS).then(async (handle) => {
      const path = await this.folderOf(owner)
      const map: YMap<SyncedPath> = handle.doc.getMap<SyncedPath>(PATHS)
      if (path === undefined) {
        // Another account of this device owns the folder; this account's other devices map no path to it.
        if (map.has(device)) map.delete(device)
        return handle
      }
      if (map.get(device)?.path !== path) map.set(device, { path })
      await this.share(owner, path)
      return handle
    }, (error: unknown) => {
      this.documents.delete(owner)
      this.ctx.logger('aeven-folder-sync').warn(`opening the synced Aeven folder paths failed: ${String(error)}`)
      return undefined
    })
    this.documents.set(owner, opening)
    return opening
  }

  /** List this device as the account's hosted peer and share with the account's listed devices, while it holds the key. */
  private async announce(owner: string): Promise<void> {
    const sync = this.ctx.get('sync')
    const fileSync = this.ctx.get('fileSync')
    const status = sync?.status(owner)
    const device = status?.device
    const keyHeld = status?.protection !== undefined && !status.protection.locked
    if (sync === undefined || fileSync === undefined || device === undefined || !keyHeld) return
    if (this.peerDocuments.has(owner)) return
    const opening = sync.openDocument(owner, PEERS).then(async (handle) => {
      const map: YMap<SyncedPeer> = handle.doc.getMap<SyncedPeer>('peers')
      const peer = await fileSync.peerId()
      if (map.get(device)?.peer !== peer || map.get(device)?.hosted !== true) map.set(device, { peer, hosted: true })
      const refresh = async (): Promise<void> => {
        const listed = new Set((await sync.devices(owner)).map(entry => String(entry.id)))
        const peers = [...map.entries()]
          .filter(([id, entry]) => id !== device && listed.has(id) && entry.hosted !== true)
          .map(([, entry]) => brandString<FileSyncPeerId>(entry.peer))
        await fileSync.setPeers(owner, peers)
      }
      map.observe((_event: YMapEvent<SyncedPeer>, transaction: Transaction) => {
        if (!transaction.local) refresh().catch(this.warn)
      })
      await refresh()
      return handle
    }, (error: unknown) => {
      this.peerDocuments.delete(owner)
      this.warn(error)
      return undefined
    })
    this.peerDocuments.set(owner, opening)
    await opening
  }

  private readonly warn = (error: unknown): void => {
    this.ctx.logger('aeven-folder-sync').warn(`aeven-folder-sync: ${String(error)}`)
  }

  /** Share the account's Aeven folder with its other devices and its file cloud copy, when file sync runs. */
  private async share(owner: string, path: string): Promise<void> {
    const fileSync = this.ctx.get('fileSync')
    if (fileSync === undefined) return
    try {
      await fileSync.share({ id: aevenFolderId(owner), owner, path })
    } catch (error: unknown) {
      this.ctx.logger('aeven-folder-sync').warn(`sharing the Aeven folder failed: ${String(error)}`)
    }
  }

  private async reset(owner: string): Promise<void> {
    const openings = [this.documents.get(owner), this.peerDocuments.get(owner)]
    this.documents.delete(owner)
    this.peerDocuments.delete(owner)
    for (const opening of openings) (await opening)?.close()
  }
}

export default AevenFolder
