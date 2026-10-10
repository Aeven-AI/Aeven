/**
 * The right-click menu of a produced file, and what its rows do on the Host.
 *
 * A produced path is enough for the reader to open it in whatever their desktop
 * opens that kind of file with, to reveal it in the file manager, and to take
 * one of its two path spellings. The menu itself is the shell's to draw, so this
 * module only exists where a desktop provides one; the browser-served client
 * leaves the platform's own menu alone, which is the menu its reader expects
 * there.
 *
 * The applications come from the Host's own registry, queried for the file at
 * the moment the menu opens: the desktop's handlers change while the
 * application runs, and an entry offered from a stale list would open the file
 * in something the reader no longer has.
 */

import type { ClientRemote } from '@aeven/api-remotes/client'
import type { SessionOpenWorkspacePathRequest, SessionWorkspacePathApplication } from '@aeven/api-session-controller/types'
import { writeClipboard } from '@aeven/client-ui-primitives'
import type { TranslateNS } from '@aeven/client-ui-slots'
import { resolveWorkspacePath } from '@aeven/util-workspace-path'

/**
 * One row of a menu the desktop shell pops, which is the shell's own
 * `DesktopMenuItem`. Restated rather than imported, for the reason the sidebar
 * browser restates the shell's bridges: a feature plugin does not take another
 * feature plugin's values, and this row's whole contract is what a menu draws.
 */
export type FileMenuRow =
  | { readonly type: 'separator' }
  | {
    readonly type: 'row'
    /** Value this plugin receives back when the row is chosen. */
    readonly id: string
    readonly label: string
    /** Whether the row can be chosen; a row that omits it can. */
    readonly enabled?: boolean
  }

/** Row ids of the file menu; the chosen id comes back from the shell. */
export const FILE_MENU_ROWS = {
  open: 'open-file',
  reveal: 'reveal-file',
  copyRelative: 'copy-relative-path',
  copyFull: 'copy-full-path',
} as const

/** The shell's menu bridge, present only where a desktop draws native menus. */
export interface FileMenuCarrier {
  /**
   * Pop one native menu for the app page.
   * @param items - the rows to show, in display order.
   * @returns the chosen row's id, or null when the reader dismissed the menu.
   */
  readonly show: (items: readonly FileMenuRow[]) => Promise<string | null>
}

/**
 * The desktop shell's menu bridge, present only inside the desktop shell.
 * @returns the bridge, or undefined when served over HTTP.
 */
export function desktopFileMenus(): FileMenuCarrier | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as { avnDesktop?: { contextMenu?: FileMenuCarrier } }).avnDesktop?.contextMenu
}

/** Copy the menu needs, which the owning plugin's dictionary supplies. */
export interface FileMenuLabels {
  /** The row that opens the file, when no application is known for it. */
  readonly open: string
  /** The row that opens the file in a named application, `{app}` replaced. */
  readonly openIn: string
  /** The row that reveals the file in the desktop's own file manager. */
  readonly reveal: string
  /** The row that copies the path the assistant wrote. */
  readonly copyRelativePath: string
  /** The row that copies the absolute path on the Host. */
  readonly copyFullPath: string
}

/**
 * The row that reveals a file, named for the file manager the platform has.
 * @param t - namespace-bound translate for this plugin's dictionary.
 * @returns "Show in Finder" on macOS, "Show in Explorer" on Windows, otherwise "Show in folder".
 */
export function revealLabel(t: TranslateNS<'deliverables'>): string {
  const platform = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/Mac/.test(platform)) return t('produced.showInFinder')
  if (/Windows/.test(platform)) return t('produced.showInExplorer')
  return t('produced.showInFolder')
}

/**
 * The menu copy for one client, resolved from this plugin's dictionary.
 * @param t - namespace-bound translate for this plugin's dictionary.
 * @returns the row labels, with the file-manager row named for this platform.
 */
export function fileMenuLabels(t: TranslateNS<'deliverables'>): FileMenuLabels {
  return {
    open: t('file.open'),
    openIn: t('file.openIn'),
    reveal: revealLabel(t),
    copyRelativePath: t('file.copyRelativePath'),
    copyFullPath: t('file.copyFullPath'),
  }
}

/**
 * The rows the menu shows for one file, default application first.
 * @param labels - this plugin's copy for the rows.
 * @param defaultApplication - the application the desktop opens this file with, when known.
 * @returns the rows, in display order.
 */
export function fileMenuRows(labels: FileMenuLabels, defaultApplication?: string): FileMenuRow[] {
  return [
    {
      type: 'row',
      id: FILE_MENU_ROWS.open,
      label: defaultApplication === undefined
        ? labels.open
        : labels.openIn.replace('{app}', defaultApplication),
    },
    { type: 'row', id: FILE_MENU_ROWS.reveal, label: labels.reveal },
    { type: 'row', id: FILE_MENU_ROWS.copyRelative, label: labels.copyRelativePath },
    { type: 'row', id: FILE_MENU_ROWS.copyFull, label: labels.copyFullPath },
  ]
}

/** What showing one file's menu needs from the application. */
export interface FileMenuDependencies {
  readonly menus: FileMenuCarrier
  readonly remote: ClientRemote
  readonly labels: FileMenuLabels
}

/**
 * The desktop name of an application, as a person knows it.
 * @param application - one entry of the Host's handler list.
 * @returns the name without macOS's bundle suffix.
 */
function displayName(application: SessionWorkspacePathApplication): string {
  return application.name.replace(/\.app$/iu, '')
}

/**
 * The Host's handlers for one file, with the default first.
 *
 * A query that fails is not a failed menu: the file still opens, reveals, and
 * copies its paths, so the menu offers what it can and the open row falls back
 * to the application the desktop itself would pick.
 * @param remote - the client's Remote namespaces.
 * @param absolutePath - the file's absolute path on the Host.
 * @returns the handlers, or an empty list when the Host named none.
 */
async function handlersFor(remote: ClientRemote, absolutePath: string): Promise<readonly SessionWorkspacePathApplication[]> {
  const result = await remote.session.workspacePathApplications({ path: absolutePath }).then(
    value => value,
    (error: unknown) => {
      console.warn(`ui-deliverables: the Host named no applications for ${absolutePath}`, error)
      return undefined
    },
  )
  if (result === undefined || !result.ok) return []
  return [...result.value].sort((left, right) => Number(right.default) - Number(left.default))
}

/**
 * Show one produced file's menu and perform what the reader chose.
 *
 * Nothing is copied or opened until a row comes back, so a dismissed menu
 * leaves the reader's desktop exactly as it was.
 * @param input - the shell bridge, the Remote namespaces, and this plugin's copy.
 * @param path - the produced path as the assistant wrote it.
 * @param cwd - the Session workspace root, used to resolve a relative path.
 */
export async function showFileMenu(
  input: FileMenuDependencies,
  path: string,
  cwd: string | undefined,
): Promise<void> {
  const absolutePath = resolveWorkspacePath(cwd, path)
  const applications = await handlersFor(input.remote, absolutePath)
  const chosen = await input.menus.show(fileMenuRows(input.labels, applications.map(displayName)[0]))
  if (chosen === null) return
  await runFileMenuRow(input.remote, chosen, { path, absolutePath, application: applications[0]?.id })
}

/**
 * Hand one path request to the Host and report a refusal.
 * @param remote - the client's Remote namespaces.
 * @param request - the path and the handoff the reader chose.
 */
async function handOff(
  remote: ClientRemote,
  request: SessionOpenWorkspacePathRequest,
): Promise<void> {
  const result = await remote.session.openWorkspacePath(request)
  if (!result.ok) console.warn(`ui-deliverables: the Host refused ${request.path}: ${result.error.message}`)
}

/**
 * Perform one chosen row of the file menu.
 * @param remote - the client's Remote namespaces.
 * @param id - the row id the shell reported.
 * @param target - the file's two spellings and the application to open it in.
 * @returns after the Host accepted or refused the handoff.
 */
async function runFileMenuRow(
  remote: ClientRemote,
  id: string,
  target: { readonly path: string; readonly absolutePath: string; readonly application: string | undefined },
): Promise<void> {
  switch (id) {
    case FILE_MENU_ROWS.open:
      await handOff(remote, target.application === undefined
        ? { path: target.absolutePath }
        : { path: target.absolutePath, application: target.application })
      return
    case FILE_MENU_ROWS.reveal:
      await handOff(remote, { path: target.absolutePath, action: 'reveal' })
      return
    case FILE_MENU_ROWS.copyRelative:
      await copy(target.path)
      return
    case FILE_MENU_ROWS.copyFull:
      await copy(target.absolutePath)
      return
  }
}

/**
 * Write one path spelling to the clipboard.
 * @param value - the exact text to place on the clipboard.
 */
async function copy(value: string): Promise<void> {
  const copied = await writeClipboard(value)
  if (!copied) console.warn('ui-deliverables: the clipboard refused a path')
}
