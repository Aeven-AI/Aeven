/** Composer-first automation management at the registered /automations address. */
import { useEffect, useState } from 'react'
import {
  Button, IconChevronDownOutline14, IconEditOutline16, IconLucideClock, IconLucidePause, IconLucidePlay, IconTrashOutline16, Tooltip,
} from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-conversation/client'
import type { SidebarNavOwnerProps } from '@aeven/client-ui-sidebar/client'
import type { ConnectionGenerationState } from '@aeven/client-connection/client'
import { AUTOMATION_TEMPLATES } from './templates.ts'
import css from './AutomationsPanel.module.css'

/** Account-owned automation projection, including authoritative recurrence and latest outcome. */
export interface Task {
  id: string
  name: string
  prompt: string
  permission: 'read-only' | 'workspace-write'
  status: 'active' | 'paused'
  schedule: { kind: 'daily' | 'weekly' | 'once' | 'interval'; timeZone: string; time?: string; weekdays?: string[]; at?: string; everyMinutes?: number; anchor?: string; until?: string }
  nextRunAt: string | null
  lastRun: Run | null
}
/** Durable execution details; finishing a turn is distinct from confirming its result. */
export interface Run {
  id: string
  definition: Pick<Task, 'id' | 'name' | 'prompt'>
  scheduledFor: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled'
  sessionId: string | null
  summary: string | null
  error: string | null
  retryOfRunId: string | null
  resolution: { kind: 'confirmed' | 'retried'; at: string; retryRunId: string | null } | null
}
/** Host-advertised time triggers and the owned management projection. */
export interface AutomationList {
  definitions: Task[]
  runs: Run[]
  capabilities: { executionTarget: 'local'; triggers: Task['schedule']['kind'][] }
}
/** Authenticated commands and connection availability bound by the entry registration. */
export interface AutomationPanelInjected {
  list: () => Promise<AutomationList>
  call: (operation: string, payload: unknown) => Promise<unknown>
  hooks: { generation: ConnectionGenerationState }
}
/** Sidebar navigation callbacks. */
export interface AutomationRowInjected {
  open: () => void
}
/** Open the management address while preserving ordinary browser link activation.
 * @param props - sidebar geometry and navigation.
 * @returns an addressable sidebar row.
 */
export function AutomationRow({ rowClassName, iconClassName, labelClassName, open, t }: SidebarNavOwnerProps & AutomationRowInjected & PropsLocale<'automations'>) {
  return (
    <a
      className={rowClassName}
      href="/automations"
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        open()
      }}
    >
      <IconLucideClock className={iconClassName} />
      <span className={labelClassName}>{t('title')}</span>
    </a>
  )
}
/** Render automations above the ordinary composer; all creation and task expansion use conversation approval.
 * @param props - session input actions, locale, and authenticated management operations.
 * @returns the automation page and capability-gated starter catalogue.
 */
export function AutomationsPanel({ t, inputActions, list, call, useGeneration }: PropsRuntime<'conversation.start'> & PropsLocale<'automations'> & InjectFace<AutomationPanelInjected>) {
  const connected = useGeneration(generation => generation !== undefined)
  const [data, setData] = useState<AutomationList | null>(null)
  const [tab, setTab] = useState<'automations' | 'runs'>('automations')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!connected) return
    let alive = true
    const load = (): void => {
      void list()
        .then((value) => { if (alive) { setData(value); setError('') } })
        .catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : t('error')) })
    }
    load()
    const timer = setInterval(load, 5000)
    return () => { alive = false; clearInterval(timer) }
  }, [connected, list, refresh, t])
  const act = (operation: string, id?: string, patch?: object): void => {
    setBusy(true); setError('')
    void call(operation, id === undefined ? {} : patch === undefined ? { id } : { id, patch })
      .then(() => { setRefresh(value => value + 1) })
      .catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : t('error')) })
      .finally(() => { setBusy(false) })
  }
  const date = (at: string): string => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const draft = (text: string): void => { inputActions.setDraft(text) }
  const unavailable = !connected || data === null || busy
  const outcome = (run: Run): string => run.resolution?.kind === 'confirmed' ? t('confirmed') : t(run.status)
  // An unresolved failure is the one last result the card carries into its ink.
  const attention = (run: Run | null): boolean => run !== null && run.status === 'failed' && run.resolution === null
  const result = (run: Run) => (
    <div className={css.result}>
      <p className={css.meta}>{date(run.scheduledFor)} · {outcome(run)}</p>
      {run.summary && <p className={css.summary}>{run.summary}</p>}
      {run.error && <p className={css.alert}>{run.error}</p>}
      {run.retryOfRunId !== null && <p className={css.note}>{t('linkedRetry')}</p>}
      <div className={css.resultActions}>
        {run.sessionId !== null && (
          <a href={`/c/${encodeURIComponent(run.sessionId.replace(/^session-/, ''))}`}>{t('conversation')}</a>
        )}
        {run.status !== 'queued' && run.status !== 'running' && run.resolution === null && (
          <>
            <Button
              variant="ghost" size="sm" className={css.action} disabled={unavailable}
              onClick={() => { if (window.confirm(t('confirmResult'))) act('confirm', run.id) }}
            >
              {t('confirmResultAction')}
            </Button>
            {run.status !== 'succeeded' && (
              <Button
                variant="ghost" size="sm" className={css.action} disabled={unavailable}
                onClick={() => { if (window.confirm(t('retryWarning'))) act('retry', run.id) }}
              >
                {t('retry')}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
  return (
    <section className={css.root} aria-label={t('title')}>
      <div className={css.content}>
        <div className={css.bar}>
          <nav className={css.tabs} aria-label={t('title')}>
            <button className={css.tab} aria-pressed={tab === 'automations'} onClick={() => { setTab('automations') }}>{t('title')}</button>
            <button className={css.tab} aria-pressed={tab === 'runs'} onClick={() => { setTab('runs') }}>{t('history')}</button>
          </nav>
          <Button variant="primary" className={css.headerAction} disabled={unavailable} onClick={() => { draft(t('newDraft')) }}>{t('create')}</Button>
        </div>
        {error && <p role="alert" className={css.alert}>{error}</p>}
        {data === null ? <p className={css.hint}>{t(connected ? 'loading' : 'offlineDetail')}</p> : tab === 'automations' ? (
          <>
            <h2 className={css.sectionTitle}>{t('routines')}</h2>
            {data.definitions.length === 0 && (
              <div className={css.empty}>
                <IconLucideClock className={css.emptyIcon} />
                <h3 className={css.emptyTitle}>{t('empty')}</h3>
                <p className={css.emptyText}>{t('emptyDetail')}</p>
              </div>
            )}
            <div className={css.list}>
              {data.definitions.map(task => (
                <article className={css.card} key={task.id}>
                  <div className={css.heading}>
                    <button
                      className={css.taskName}
                      aria-expanded={expanded === task.id}
                      onClick={() => { setExpanded(expanded === task.id ? null : task.id) }}
                    >
                      {task.name}
                      <IconChevronDownOutline14 className={css.chevron} />
                    </button>
                    <span className={css.status} data-tone={task.status}>{t(task.status)}</span>
                  </div>
                  <dl className={css.facts}>
                    <div className={css.fact}>
                      <dt className={css.factLabel}>{t('next')}</dt>
                      <dd className={css.factValue}>
                        {task.status === 'paused' ? t('paused') : task.nextRunAt === null ? t('noNext') : date(task.nextRunAt)}
                      </dd>
                    </div>
                    <div className={css.fact}>
                      <dt className={css.factLabel}>{t('last')}</dt>
                      <dd className={css.factValue} data-tone={attention(task.lastRun) ? 'attention' : undefined}>
                        {task.lastRun === null ? t('noRuns') : `${outcome(task.lastRun)} · ${date(task.lastRun.scheduledFor)}`}
                      </dd>
                    </div>
                  </dl>
                  {expanded === task.id && (
                    <div className={css.details}>
                      <p className={css.prompt}>{task.prompt}</p>
                      <p className={css.note}>{task.schedule.timeZone}</p>
                      {task.lastRun !== null && result(task.lastRun)}
                    </div>
                  )}
                  <div className={css.cardActions}>
                    <Button
                      variant="primary" size="sm" className={css.runNow} icon={<IconLucidePlay />}
                      disabled={unavailable} onClick={() => { act('run', task.id) }}
                    >
                      {t('run')}
                    </Button>
                    <Tooltip label={t(task.status === 'active' ? 'pause' : 'resume')} side="top" anchor="icon">
                      <span className={css.tip}>
                        <Button
                          variant="ghost" size="sm" className={`${css.action} ${css.iconAction}`}
                          icon={task.status === 'active' ? <IconLucidePause /> : <IconLucidePlay />}
                          aria-label={t(task.status === 'active' ? 'pause' : 'resume')} disabled={unavailable}
                          onClick={() => { act('update', task.id, { status: task.status === 'active' ? 'paused' : 'active' }) }}
                        />
                      </span>
                    </Tooltip>
                    <Tooltip label={t('edit')} side="top" anchor="icon">
                      <span className={css.tip}>
                        <Button
                          variant="ghost" size="sm" className={`${css.action} ${css.iconAction}`} icon={<IconEditOutline16 />}
                          aria-label={t('edit')} disabled={unavailable}
                          onClick={() => { draft(t('editDraft', { id: task.id, name: task.name })) }}
                        />
                      </span>
                    </Tooltip>
                    <Tooltip label={t('remove')} side="top" anchor="icon">
                      <span className={css.tip}>
                        <Button
                          variant="ghost" size="sm" className={`${css.action} ${css.iconAction}`} icon={<IconTrashOutline16 />}
                          aria-label={t('remove')} disabled={unavailable}
                          onClick={() => { if (window.confirm(t('confirmation'))) act('delete', task.id) }}
                        />
                      </span>
                    </Tooltip>
                  </div>
                </article>
              ))}
            </div>
            <h2 className={css.sectionTitle}>{t('recommended')}</h2>
            <div className={css.templates}>
              {AUTOMATION_TEMPLATES.filter(template => data.capabilities.triggers.includes(template.trigger)).map(template => (
                <button
                  className={css.template}
                  key={template.id}
                  disabled={unavailable}
                  onClick={() => { draft(t(template.draft, { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })) }}
                >
                  <span className={css.templateIcon}><template.icon /></span>
                  <span className={css.templateTitle}>{t(template.title)}</span>
                  <span className={css.templateDescription}>{t(template.description)}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h2 className={css.sectionTitle}>{t('history')}</h2>
            {data.runs.length === 0 && <div className={css.empty}><p className={css.emptyText}>{t('noRuns')}</p></div>}
            <div className={css.list}>
              {data.runs.map(run => (
                <details className={css.card} key={run.id}>
                  <summary className={css.runSummary}>
                    <span className={css.runSummaryRow}>
                      <span className={css.runName}>{run.definition.name}</span>
                      <span className={css.runMeta}>
                        {outcome(run)} · {date(run.scheduledFor)}
                        <IconChevronDownOutline14 className={css.chevron} />
                      </span>
                    </span>
                  </summary>
                  {result(run)}
                </details>
              ))}
            </div>
            {data.runs.length > 0 && (
              <div className={css.clearRow}>
                <Button
                  variant="ghost" size="sm" icon={<IconTrashOutline16 />} disabled={unavailable}
                  onClick={() => { if (window.confirm(t('clearConfirm'))) act('clear') }}
                >
                  {t('clearRuns')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
