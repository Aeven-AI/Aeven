/**
 * Settings → Files: one switch that pauses file sync on this computer, the account's workspaces with where their
 * files live here, and, behind **Show advanced**, the patterns of files that never sync.
 */
import { useEffect, useState } from 'react'
import type { WorkspaceFilesSettings } from '@aeven/api-workspace-controller/client'
import { Button, LoadingBlock, SectionHeader, SettingsGroup, SettingsRow, Switch } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { filesStatusText } from '../rows/Rows.tsx'
import css from './FilesSection.module.css'

/** Registration-side operations the page calls. */
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
  PropsRuntime<'settings.section'>
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
 * The Files section.
 * @param props - slot runtime, locale, and injected operations.
 * @returns the rendered section.
 */
export function FilesSection(props: FilesSectionProps) {
  const { t } = props
  const [settings, setSettings] = useState<WorkspaceFilesSettings | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [advanced, setAdvanced] = useState(false)
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
  const header = <SectionHeader title={t('filesSettings.nav')} description={t('filesSettings.intro')} />
  if (settings === undefined) {
    return <div className={css.section}>{header}{failed
      ? <SettingsRow title={t('filesSettings.failed')} control={<Button onClick={() => { setFailed(false); setRetry(value => value + 1) }}>{t('filesSettings.retry')}</Button>} />
      : <LoadingBlock label={t('filesSettings.loading')} />}</div>
  }
  const saved = settings.ignores.join('\n')
  const text = draft ?? saved
  return (
    <div className={css.section}>
      {header}
      {failed && <p role="alert">{t('filesSettings.failed')}</p>}
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
      {settings.workspaces.length > 0 && (
        <SettingsGroup title={t('filesSettings.workspaces')}>
          {settings.workspaces.map(workspace => (
            <SettingsRow
              key={workspace.workspaceId}
              title={workspace.title}
              description={[
                workspace.path ?? t('filesSettings.notHere'),
                ...workspace.files === null ? [] : [filesStatusText(workspace.files, t)],
              ].join(' · ')}
              control={workspace.path === null
                ? undefined
                : (
                  <Button variant="ghost" size="sm" onClick={() => { if (workspace.path !== null) props.reveal(workspace.path) }}>
                    {t(revealKey())}
                  </Button>
                )}
            />
          ))}
        </SettingsGroup>
      )}
      <div className={css.reveal}>
        <Button variant="ghost" size="sm" aria-expanded={advanced} onClick={() => { setAdvanced(value => !value) }}>
          {t(advanced ? 'filesSettings.hideAdvanced' : 'filesSettings.showAdvanced')}
        </Button>
      </div>
      {advanced && (
        <SettingsGroup title={t('filesSettings.ignores')}>
          <p className={css.note}>{t('filesSettings.ignoresBody')}</p>
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
              size="sm"
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
        </SettingsGroup>
      )}
    </div>
  )
}
