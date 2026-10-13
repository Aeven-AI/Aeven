/**
 * "Open with": hand a workspace path to the serving desktop, in its default
 * application, in another registered application, or revealed in the file
 * manager. The application list is the Host's own (`session.
 * workspacePathApplications`), queried per file and refreshed each time a menu
 * opens, so it follows the desktop's current handlers.
 */
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientRemote } from '@aeven/api-remotes/client'
import type { SessionWorkspacePathApplication } from '@aeven/api-session-controller/types'
import {
  IconLucideChevronDown, IconLucideFolderOpen, IconLucideSquareArrowOutUpRight, Menu, type MenuItem,
} from '@aeven/client-ui-primitives'
import type { TranslateNS } from '@aeven/client-ui-slots'
import css from './FilesPane.module.css'

/** One desktop handoff for a path. */
export type OpenOperation =
  | { readonly kind: 'default' }
  | { readonly kind: 'application'; readonly id: string }
  | { readonly kind: 'reveal' }

/** A file's current handlers as the menus show them. */
export interface Applications {
  readonly apps: readonly SessionWorkspacePathApplication[]
  readonly loading: boolean
  readonly failed: boolean
  readonly refresh: () => void
}

/** The last handler query and the path it was for. */
interface Query {
  readonly path: string | null
  readonly apps: readonly SessionWorkspacePathApplication[]
  readonly loading: boolean
  readonly failed: boolean
}

/** Menu row ids: `app:<id>` for a handler, `reveal` for the file manager. */
const APP_PREFIX = 'app:'

/**
 * Hand one absolute path to the Host desktop.
 * @param remote - the client's Remote namespaces.
 * @param path - absolute Host path.
 * @param operation - which handoff to make.
 * @returns after the Host accepted or refused the handoff; refusals are logged.
 */
export async function openOnDesktop(remote: ClientRemote, path: string, operation: OpenOperation): Promise<void> {
  const result = await remote.session.openWorkspacePath(
    operation.kind === 'reveal' ? { path, action: 'reveal' }
      : operation.kind === 'application' ? { path, application: operation.id }
        : { path },
  )
  if (!result.ok) console.warn(`open failed for ${path}: ${result.error.message}`)
}

/**
 * Map a selected menu row id back to its handoff.
 * @param id - the row id from {@link applicationItems}.
 * @returns the handoff, or null for rows that are not handoffs.
 */
export function operationOf(id: string): OpenOperation | null {
  if (id === 'reveal') return { kind: 'reveal' }
  if (id.startsWith(APP_PREFIX)) return { kind: 'application', id: id.slice(APP_PREFIX.length) }
  return null
}

/**
 * The label for revealing a path in the desktop's file manager.
 * @param t - namespace-bound translate.
 * @returns "Show in Finder" on macOS, "Show in Explorer" on Windows, otherwise "Show in folder".
 */
export function revealLabel(t: TranslateNS<'sidebarFiles'>): string {
  const platform = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/Mac/.test(platform)) return t('reveal.finder')
  if (/Windows/.test(platform)) return t('reveal.explorer')
  return t('reveal.folder')
}

/**
 * Query a file's handlers while `path` is non-null and `enabled`.
 * @param remote - the client's Remote namespaces.
 * @param path - absolute Host path, or null when there is nothing to query.
 * @param enabled - whether the Host can open paths at all.
 * @returns the handlers, their query state, and a re-query callback.
 */
export function useApplications(remote: ClientRemote, path: string | null, enabled: boolean): Applications {
  const [state, setState] = useState<Query>({ path: null, apps: [], loading: true, failed: false })
  const controller = useRef<AbortController | null>(null)
  const refresh = useCallback(() => {
    controller.current?.abort()
    if (path === null || !enabled) return
    const current = new AbortController()
    controller.current = current
    setState(previous => previous.path === path
      ? { ...previous, loading: previous.apps.length === 0 }
      : { path, apps: [], loading: true, failed: false })
    void remote.session.workspacePathApplications({ path }, current.signal).then((result) => {
      if (current.signal.aborted) return
      setState(result.ok
        ? { path, apps: result.value, loading: false, failed: false }
        : { path, apps: [], loading: false, failed: true })
    }, () => {
      if (!current.signal.aborted) setState({ path, apps: [], loading: false, failed: true })
    })
  }, [enabled, path, remote])
  useEffect(() => {
    refresh()
    return () => { controller.current?.abort() }
  }, [refresh])
  const own = state.path === path
  return { apps: own ? state.apps : [], loading: !own || state.loading, failed: own && state.failed, refresh }
}

/** A handler's name as the desktop shows it, without macOS's bundle suffix. */
function displayName(app: SessionWorkspacePathApplication): string {
  return app.name.replace(/\.app$/i, '')
}

/** One handler's icon, or a generic glyph when the desktop gave none or it fails to load. */
function ApplicationIcon({ source }: { source: string | null }): ReactNode {
  const [failed, setFailed] = useState(false)
  return source === null || failed
    ? <IconLucideSquareArrowOutUpRight />
    : <img src={source} width={16} height={16} className={css.appIcon} alt="" draggable={false} onError={() => { setFailed(true) }} />
}

/**
 * The menu rows for a file's handlers, the default first, then the reveal row.
 * @param applications - the file's handlers.
 * @param t - namespace-bound translate.
 * @returns rows whose ids {@link operationOf} maps back to handoffs.
 */
export function applicationItems(applications: Applications, t: TranslateNS<'sidebarFiles'>): MenuItem[] {
  const ordered = [...applications.apps].sort((left, right) => Number(right.default) - Number(left.default))
  return [
    ...ordered.map(app => ({
      id: `${APP_PREFIX}${app.id}`,
      icon: <ApplicationIcon key={app.icon} source={app.icon} />,
      label: app.default ? t('openWith.default', { app: displayName(app) }) : displayName(app),
    })),
    ...applications.loading && ordered.length === 0 ? [{ id: 'loading', label: t('openWith.loading'), disabled: true }] : [],
    ...applications.failed ? [{ id: 'failed', label: t('openWith.error'), disabled: true }] : [],
    ...!applications.loading && !applications.failed && ordered.length === 0 ? [{ id: 'none', label: t('openWith.none'), disabled: true }] : [],
    { id: 'reveal', icon: <IconLucideFolderOpen />, label: revealLabel(t) },
  ]
}

/**
 * The open file's split button: its default application's icon opens it
 * there, the chevron lists every handler and the file manager.
 * @param props.path - absolute Host path of the open file.
 * @param props.remote - the client's Remote namespaces.
 * @param props.t - namespace-bound translate.
 * @returns the button pair and its menu.
 */
export function OpenWithButton({ path, remote, t }: { path: string; remote: ClientRemote; t: TranslateNS<'sidebarFiles'> }): ReactNode {
  const [open, setOpen] = useState(false)
  const applications = useApplications(remote, path, true)
  const preferred = applications.apps.find(app => app.default)
  const run = (operation: OpenOperation) => {
    setOpen(false)
    void openOnDesktop(remote, path, operation)
  }
  const label = preferred === undefined ? revealLabel(t) : t('openWith.open', { app: displayName(preferred) })
  return (
    <Menu
      open={open}
      portal
      align="end"
      onClose={() => { setOpen(false) }}
      items={applicationItems(applications, t)}
      onSelect={(id) => {
        const operation = operationOf(id)
        if (operation !== null) run(operation)
      }}
      anchor={(
        <span className={css.openWith}>
          <button
            type="button"
            className={css.openWithMain}
            aria-label={label}
            title={label}
            onClick={() => { run(preferred === undefined ? { kind: 'reveal' } : { kind: 'default' }) }}
          >
            {preferred === undefined ? <IconLucideFolderOpen /> : <ApplicationIcon key={preferred.icon} source={preferred.icon} />}
          </button>
          <button
            type="button"
            className={css.openWithMore}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t('openWith.more')}
            title={t('openWith.more')}
            onClick={() => {
              if (!open) applications.refresh()
              setOpen(value => !value)
            }}
          >
            <IconLucideChevronDown />
          </button>
        </span>
      )}
    />
  )
}
