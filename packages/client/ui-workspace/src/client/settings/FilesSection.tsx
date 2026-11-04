/**
 * The Files group inside Settings → Sync: one switch that pauses file sync on this computer, the account's workspaces
 * with where their files live here and how far each has synced, and, behind **Edit**, the patterns of files that never
 * sync.
 */
import { useEffect, useState } from 'react'
import type { WorkspaceFilesEntry, WorkspaceFilesSettings } from '@aeven/api-workspace-controller/client'
import { Button, LoadingBlock, SettingsGroup, SettingsRow, Switch } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { filesStatusText } from '../rows/Rows.tsx'
import css from './FilesSection.module.css'

/** Registration-side operations the group calls. */
export interface FilesSectionInjected {
  /** Read file sync on this computer. */
  load: () => Promise<WorkspaceFilesSettings>
  /** Pause or resume file sync on this computer. */
  setPaused: (paused: boolean) => Promise<WorkspaceFilesSettings>
  /** Replace the patterns of files that never sync. */
  setIgnores: (ignores: readonly string[]) => Promise<WorkspaceFilesSettings>
  /** Show a directory in the desktop's file manager. */
  reveal: (path: string) => void
  /** Listen for changes of the account's workspaces, such as a new file status. */
  onChange: (listener: () => void) => () => void
}

/** Full component props assembled by the slot renderer. */
export type FilesSectionProps =
  PropsRuntime<'settings.sync.files'>
  & PropsLocale<'workspace'>
  & InjectFace<FilesSectionInjected>

/** The platform's name for revealing a folder in its file manager. */
function revealKey(): 'filesSettings.revealFinder' | 'filesSettings.revealExplorer' | 'filesSettings.revealFolder' {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/Mac/u.test(agent)) return 'filesSettings.revealFinder'
  if (/Windows/u.test(agent)) return 'filesSettings.revealExplorer'
  return 'filesSettings.revealFolder'
}

/**
 * One workspace's row: where its files live here, its file status, and a bar while a size is known.
 * @param props - the workspace, whether sync is paused, the translate seat, and the reveal action.
 * @returns the row.
 */
function WorkspaceRow({ workspace, paused, t, reveal }: {
  workspace: WorkspaceFilesEntry
  paused: boolean
  t: FilesSectionProps['t']
  reveal: (path: string) => void
}) {
  const status = workspace.files === null
    ? (paused || workspace.path === null ? undefined : t('filesSettings.upToDate'))
    : filesStatusText(workspace.files, t)
  const progress = workspace.files?.state === 'syncing' ? workspace.files.progress : null
  const path = workspace.path
  return (
    <SettingsRow
      title={workspace.title}
      description={[path ?? t('filesSettings.notHere'), ...status === undefined ? [] : [status]].join(' · ')}
      control={path === null
        ? undefined
        : <Button variant="outline" onClick={() => { reveal(path) }}>{t(revealKey())}</Button>}
    >
      {progress !== null && (
        <span
          className={css.meter} role="progressbar" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.floor(progress * 100)} aria-label={status}
        >
          <span style={{ width: `${String(Math.max(progress * 100, 2))}%` }} />
        </span>
      )}
    </SettingsRow>
  )
}

/**
 * The Files group.
 * @param props - slot runtime, locale, and injected operations.
 * @returns the rendered group.
 */
export function FilesSection(props: FilesSectionProps) {
  const { t } = props
  const [settings, setSettings] = useState<WorkspaceFilesSettings | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string | undefined>(undefined)
  useEffect(() => {
    let live = true
    const read = (): void => {
      props.load().then((next) => {
        if (live) { setSettings(next); setFailed(false) }
      }, () => { if (live) setFailed(true) })
    }
    read()
    const stop = props.onChange(read)
    return () => {
      live = false
      stop()
    }
  }, [props.load, props.onChange, retry])
  const run = (change: () => Promise<WorkspaceFilesSettings>): void => {
    setBusy(true)
    setFailed(false)
    change().then(setSettings, () => { setFailed(true) }).finally(() => { setBusy(false) })
  }
  if (settings === undefined) {
    return (
      <SettingsGroup title={t('filesSettings.nav')} description={t('filesSettings.intro')}>
        {failed
          ? <SettingsRow title={t('filesSettings.failed')} control={<Button variant="outline" onClick={() => { setFailed(false); setRetry(value => value + 1) }}>{t('filesSettings.retry')}</Button>} />
          : <LoadingBlock label={t('filesSettings.loading')} />}
      </SettingsGroup>
    )
  }
  const saved = settings.ignores.join('\n')
  const text = draft ?? saved
  return (
    <SettingsGroup title={t('filesSettings.nav')} description={t('filesSettings.intro')}>
      {failed && <p className={css.failed} role="alert">{t('filesSettings.failed')}</p>}
      <SettingsRow
        title={t('filesSettings.sync')}
        description={t(settings.paused ? 'filesSettings.syncOff' : 'filesSettings.syncOn')}
        control={(
          <Switch
            checked={!settings.paused}
            label={t('filesSettings.sync')}
            disabled={busy}
            onChange={(next) => { run(() => props.setPaused(!next)) }}
          />
        )}
      />
      {settings.workspaces.map(workspace => (
        <WorkspaceRow key={workspace.workspaceId} workspace={workspace} paused={settings.paused} t={t} reveal={props.reveal} />
      ))}
      <SettingsRow
        title={t('filesSettings.ignores')}
        description={t('filesSettings.ignoresBody')}
        control={(
          <Button variant="outline" aria-expanded={editing} onClick={() => { setEditing(value => !value); setDraft(undefined) }}>
            {t(editing ? 'filesSettings.done' : 'filesSettings.edit')}
          </Button>
        )}
      >
        {editing && (
          <div className={css.editor}>
            <textarea
              className={css.ignores}
              value={text}
              aria-label={t('filesSettings.ignores')}
              spellCheck={false}
              rows={Math.min(14, Math.max(6, text.split('\n').length + 1))}
              onChange={(event) => { setDraft(event.target.value) }}
            />
            <div className={css.actions}>
              <Button
                variant="primary"
                disabled={busy || text === saved}
                onClick={() => {
                  run(async () => {
                    const next = await props.setIgnores(text.split('\n'))
                    setDraft(undefined)
                    return next
                  })
                }}
              >
                {t('filesSettings.save')}
              </Button>
            </div>
          </div>
        )}
      </SettingsRow>
    </SettingsGroup>
  )
}
