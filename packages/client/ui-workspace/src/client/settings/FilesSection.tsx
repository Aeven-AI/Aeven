/**
 * The Files group inside Settings → Sync: one switch that pauses file sync on this computer, the account's workspaces
 * with where their files live here and how far each has synced, and, behind **Edit**, the patterns of files that never
 * sync.
 */
import { useEffect, useState } from 'react'
import type { WorkspaceFileState, WorkspaceFilesEntry, WorkspaceFilesSettings, WorkspaceFilesView } from '@aeven/api-workspace-controller/client'
import { Button, LoadingBlock, SettingsGroup, SettingsMeter, SettingsRow, Switch, type SettingsMeterProps } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { filesStatusLabel } from '../rows/Rows.tsx'
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

/** A directory with the home directory written as `~`, the way a file manager's path bar reads it. */
function shortPath(path: string): string {
  const home = /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[/\\]|$)/u.exec(path)?.[0]
  return home === undefined ? path : `~${path.slice(home.length)}`
}

/** Each file state's bar tone; `moving` states without a known size sweep the bar instead of filling it. */
const METER_TONE: Record<WorkspaceFileState, { tone: NonNullable<SettingsMeterProps['tone']>; moving: boolean }> = {
  'syncing': { tone: 'success', moving: true },
  'installing': { tone: 'success', moving: true },
  'preparing': { tone: 'success', moving: true },
  'paused': { tone: 'muted', moving: false },
  'stopped': { tone: 'muted', moving: false },
  'waiting': { tone: 'muted', moving: false },
  'git-needed': { tone: 'muted', moving: false },
  'conflict': { tone: 'error', moving: false },
  'failed': { tone: 'error', moving: false },
}

/** How full a workspace's bar is and in which tone: whole while current, its share while syncing, empty otherwise. */
function meterOf(files: WorkspaceFilesView | null, paused: boolean): Pick<SettingsMeterProps, 'percent' | 'tone'> {
  if (files === null) return { percent: 100, tone: paused ? 'muted' : 'success' }
  const { tone, moving } = METER_TONE[files.state]
  const percent = files.progress === null ? (moving && !paused ? null : 0) : files.progress * 100
  return { percent, tone: paused ? 'muted' : tone }
}

/**
 * One workspace's row: its name, where its files live here, the button that shows them, and a bar of how far it
 * has synced.
 * @param props - the workspace, whether sync is paused, the translate seat, and the reveal action.
 * @returns the row.
 */
function WorkspaceRow({ workspace, paused, t, reveal }: {
  workspace: WorkspaceFilesEntry
  paused: boolean
  t: FilesSectionProps['t']
  reveal: (path: string) => void
}) {
  const { files, path } = workspace
  const label = paused ? t('files.stopped') : files === null ? t('filesSettings.upToDate') : filesStatusLabel(files, t)
  const meter = meterOf(files, paused)
  return (
    <SettingsRow
      title={workspace.title}
      description={<span className={css.path} title={path ?? undefined}>{path === null ? t('filesSettings.notHere') : shortPath(path)}</span>}
      control={path === null
        ? undefined
        : <Button variant="primary" onClick={() => { reveal(path) }}>{t(revealKey())}</Button>}
    >
      <SettingsMeter
        label={label}
        value={meter.percent === null ? undefined : `${String(Math.floor(meter.percent))}%`}
        percent={meter.percent}
        tone={meter.tone}
        ariaLabel={`${workspace.title}: ${label}`}
      />
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
