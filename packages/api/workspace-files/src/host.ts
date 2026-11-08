/**
 * Host-filesystem helpers behind the explorer's write actions and change stream: entry-name validation, moving an
 * entry to the platform's trash, and one recursive watcher per workspace root shared by every subscriber.
 *
 * Everything here works on absolute paths of the Host's own filesystem, so the service calls it only when the
 * composed filesystem maps its paths one-to-one onto the Host's.
 * @module
 */
import { execFile } from 'node:child_process'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { delimiter, join, sep } from 'node:path'
import type { WorkspaceFileChange } from './types.ts'

/** Names Windows refuses for a file or folder, with or without an extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i

/** Characters no entry name may carry on any platform the Host runs on. */
const FORBIDDEN_CHARACTERS = /[/\\:*?"<>|\u0000-\u001f]/

/**
 * Why a new entry name cannot be used, or undefined when it can.
 * @param name - the name a reader typed, without any folder.
 * @returns a short reason, or undefined for a usable name.
 */
export function invalidName(name: string): string | undefined {
  if (name.trim() === '') return 'the name is empty'
  if (name === '.' || name === '..') return 'the name cannot be "." or ".."'
  if (FORBIDDEN_CHARACTERS.test(name)) return 'the name contains a character that cannot appear in a file name'
  if (WINDOWS_RESERVED.test(name)) return 'the name is reserved by Windows'
  if (/[. ]$/.test(name)) return 'the name cannot end with a dot or a space'
  if (Buffer.byteLength(name, 'utf8') > 255) return 'the name is too long'
  return undefined
}

/** Whether `command` is an executable on this Host's `PATH`. */
function onPath(command: string): boolean {
  return (process.env['PATH'] ?? '').split(delimiter).some(directory => directory !== '' && existsSync(join(directory, command)))
}

/** The command that moves one path to this platform's trash, or undefined where none exists. */
function trashCommand(): ((path: string) => { file: string; args: string[] }) | undefined {
  switch (process.platform) {
    case 'darwin':
      // macOS 14 and later ship `trash`; Finder's scripting interface covers earlier releases.
      if (existsSync('/usr/bin/trash')) return path => ({ file: '/usr/bin/trash', args: [path] })
      return path => ({
        file: '/usr/bin/osascript',
        args: ['-e', 'on run argv', '-e', 'tell application "Finder" to delete POSIX file (item 1 of argv)', '-e', 'end run', path],
      })
    case 'win32':
      return path => ({
        file: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command',
          'Add-Type -AssemblyName Microsoft.VisualBasic; $p = $args[0]; '
          + 'if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, \'OnlyErrorDialogs\', \'SendToRecycleBin\') } '
          + 'else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, \'OnlyErrorDialogs\', \'SendToRecycleBin\') }',
          path],
      })
    default:
      return onPath('gio') ? path => ({ file: 'gio', args: ['trash', '--', path] }) : undefined
  }
}

/** This Host's trash command, looked up once. */
let trash: ReturnType<typeof trashCommand> | null = null

/**
 * Whether this Host can move an entry to a trash the reader can restore it from.
 * @returns true where a trash command exists.
 */
export function hasTrash(): boolean {
  trash ??= trashCommand()
  return trash !== undefined
}

/**
 * Move one entry to this Host's trash.
 * @param path - absolute Host path of the file or folder.
 * @param signal - aborts the command.
 * @returns after the platform reports the entry moved.
 * @throws when this Host has no trash, or the command fails.
 */
export function moveToTrash(path: string, signal: AbortSignal): Promise<void> {
  trash ??= trashCommand()
  const command = trash
  if (command === undefined) return Promise.reject(new Error('this Host has no trash'))
  const { file, args } = command(path)
  return new Promise((resolve, reject) => {
    execFile(file, args, { signal, windowsHide: true, timeout: 60_000 }, (error, _stdout, stderr) => {
      if (error === null) resolve()
      else reject(new Error(stderr.trim() === '' ? error.message : stderr.trim(), { cause: error }))
    })
  })
}

/** One subscriber to a root's changes. */
type ChangeListener = (changes: readonly WorkspaceFileChange[]) => void

/** One watched root and the subscribers it serves. */
interface WatchedRoot {
  readonly watcher: FSWatcher
  /** Each subscriber's batch listener and its failure handler. */
  readonly listeners: Map<ChangeListener, (error: Error) => void>
  /** Changes gathered since the last delivery, keyed by path. */
  readonly pending: Map<string, WorkspaceFileChange['kind'] | 'unknown'>
  timer: ReturnType<typeof setTimeout> | undefined
}

/** Roots under watch, by absolute Host path. */
const roots = new Map<string, WatchedRoot>()

/** Options of {@link watchRoot}. */
export interface WatchOptions {
  /** Folder names whose contents report no change, such as `.git`. */
  readonly ignore: ReadonlySet<string>
  /** Delay gathering a burst of changes into one delivery. */
  readonly delayMs: number
}

/**
 * Subscribe to changes under one root. Every subscriber of a root shares one recursive watcher, opened with the first
 * and closed with the last; a burst of changes is delivered as one batch per `delayMs`.
 * @param root - absolute Host path of the workspace root.
 * @param options - ignored folder names and the gathering delay.
 * @param listener - receives each batch, paths relative to the root with `/` separators.
 * @param onError - receives a watcher failure, after which this subscription delivers nothing more.
 * @returns the unsubscribe function.
 * @throws when the platform cannot watch the root recursively.
 */
export function watchRoot(
  root: string,
  options: WatchOptions,
  listener: ChangeListener,
  onError: (error: Error) => void,
): () => void {
  let entry = roots.get(root)
  if (entry === undefined) {
    const watcher = watch(root, { recursive: true, persistent: false })
    const created: WatchedRoot = { watcher, listeners: new Map(), pending: new Map(), timer: undefined }
    watcher.on('change', (event: string, filename: string) => {
      const path = filename.split(sep).join('/')
      if (path.split('/').some(part => options.ignore.has(part))) return
      created.pending.set(path, event === 'change' ? 'changed' : 'unknown')
      created.timer ??= setTimeout(() => { void deliver(root, created) }, options.delayMs)
    })
    watcher.on('error', (error) => {
      roots.delete(root)
      watcher.close()
      if (created.timer !== undefined) clearTimeout(created.timer)
      const failed = [...created.listeners.values()]
      created.listeners.clear()
      for (const report of failed) report(error)
    })
    roots.set(root, created)
    entry = created
  }
  const watched = entry
  watched.listeners.set(listener, onError)
  return () => {
    watched.listeners.delete(listener)
    if (watched.listeners.size > 0 || roots.get(root) !== watched) return
    roots.delete(root)
    if (watched.timer !== undefined) clearTimeout(watched.timer)
    watched.watcher.close()
  }
}

/** Resolve each gathered path's kind from the filesystem and hand the batch to every subscriber. */
async function deliver(root: string, entry: WatchedRoot): Promise<void> {
  entry.timer = undefined
  const gathered = [...entry.pending]
  entry.pending.clear()
  const changes = await Promise.all(gathered.map(async ([path, kind]): Promise<WorkspaceFileChange> => {
    if (kind !== 'unknown') return { path, kind }
    // A rename event names both ends of a move, a creation, and a deletion alike; the entry's presence tells them apart.
    const present = await stat(join(root, path)).then(() => true, () => false)
    return { path, kind: present ? 'created' : 'deleted' }
  }))
  for (const listener of entry.listeners.keys()) listener(changes)
}
