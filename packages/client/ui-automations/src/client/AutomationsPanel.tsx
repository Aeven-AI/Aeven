/** Composer-first automation management at the registered /automations address. */
import { useEffect, useState } from 'react'
import {
  Button, IconBotOutline16, IconChevronDownOutline14, IconCopyOutline16, IconEditOutline16, IconLucideCheck,
  IconLucideClock, IconLucideMinus,
  IconLucidePause, IconLucidePlay,
  IconLucideRotateCcw, IconLucideX, IconTrashOutline16, Modal, Spinner, Tooltip, writeClipboard,
} from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-conversation/client'
import type { SidebarNavOwnerProps } from '@aeven/client-ui-sidebar/client'
import type { ConnectionGenerationState } from '@aeven/client-connection/client'
import { IconPlug, IconSparkles } from './icons.tsx'
import { SERVICE_NEEDS, TEMPLATE_CATEGORIES, templateTrigger, type AutomationTemplate, type ServiceNeed } from './templates.ts'
import css from './AutomationsPanel.module.css'

/** Last management projection, so switching between the two view addresses shows it instead of a loading state. */
let lastList: AutomationList | null = null

/** Locale key of each service group's Connect action. */
const CONNECT_LABELS = { mail: 'connectMail', calendar: 'connectCalendar', github: 'connectGithub' } as const satisfies Record<ServiceNeed, string>

/** The page's own confirmation, in place of the browser's, for every action that
 * removes records, invalidates a credential, or repeats work that may already
 * have changed something. */
type PendingAction =
  | { kind: 'clear' }
  | { kind: 'delete'; id: string }
  | { kind: 'remove-run'; id: string }
  | { kind: 'retry'; id: string }
  | { kind: 'webhook-rotate'; id: string }
  | { kind: 'webhook-remove'; id: string }

/** Connector providers the signed-in account has connected and the deployment can sign in to. */
export interface ServiceState {
  connected: ReadonlySet<string>
  configured: ReadonlySet<string>
}

/** Neutral status glyph for a run; outcomes never use alarm colour.
 * @param status - run status.
 * @returns the glyph shown in the run's leading tile.
 */
function statusIcon(status: Run['status']) {
  switch (status) {
    case 'queued': return <IconLucideClock />
    case 'running': return <Spinner />
    case 'succeeded': return <IconLucideCheck />
    case 'failed': return <IconLucideX />
    case 'skipped':
    case 'cancelled': return <IconLucideMinus />
  }
}

/** One stored recurrence, discriminated the way the Host stores and returns it. */
export type TaskSchedule =
  | { kind: 'once'; timeZone: string; at: string; until?: string | undefined }
  | { kind: 'interval'; timeZone: string; everyMinutes: number; anchor: string; until?: string | undefined }
  | { kind: 'hours'; timeZone: string; everyHours: number; atMinute: number; until?: string | undefined }
  | { kind: 'daily'; timeZone: string; time: string; until?: string | undefined }
  | { kind: 'weekly'; timeZone: string; time: string; weekdays: string[]; until?: string | undefined }
  | { kind: 'monthly'; timeZone: string; time: string; days: number[]; until?: string | undefined }
  | { kind: 'nth-weekday'; timeZone: string; time: string; week: 1 | 2 | 3 | 4; weekday: string; until?: string | undefined }
  | { kind: 'yearly'; timeZone: string; time: string; month: number; day: number; until?: string | undefined }
  | { kind: 'cron'; timeZone: string; expression: string; until?: string | undefined }

/** Account-owned automation projection, including authoritative recurrence and latest outcome. */
export interface Task {
  id: string
  name: string
  prompt: string
  permission: 'read-only' | 'workspace-write'
  status: 'active' | 'paused'
  schedule: TaskSchedule
  nextRunAt: string | null
  lastRun: Run | null
  /** Whether an inbound trigger credential exists; the key itself never arrives in this list. */
  webhook: boolean
}
/** Durable execution record; its conversation holds the actual result. */
export interface Run {
  id: string
  definition: Pick<Task, 'id' | 'name' | 'prompt'>
  scheduledFor: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled'
  sessionId: string | null
  error: string | null
  resolution: { kind: 'retried'; at: string; retryRunId: string | null } | null
}
/** Host-advertised time triggers and the owned management projection. */
export interface AutomationList {
  definitions: Task[]
  runs: Run[]
  capabilities: { executionTarget: 'local'; triggers: TaskSchedule['kind'][]; webhook: boolean }
}
/** Inbound trigger address and key, read on demand so the list never carries the secret. */
export interface WebhookCredential {
  path: string
  keyId: string
  secret: string
}
/** Authenticated commands and connection availability bound by the entry registration. */
export interface AutomationPanelInjected {
  list: () => Promise<AutomationList>
  call: (operation: string, payload: unknown) => Promise<unknown>
  hooks: { generation: ConnectionGenerationState }
  /** Open a run's conversation in place. */
  openRun: (sessionId: string) => void
  /** View this registration's address shows: `/automations` or `/automations/runs`. */
  view: 'automations' | 'runs'
  /** Navigate to the address of a view. */
  showView: (view: 'automations' | 'runs') => void
  /** Connector state, or null when this composition has no account integrations. */
  services: () => Promise<ServiceState | null>
  /** Open Settings at one connector's page, or at the connector list. */
  openConnector: (provider?: string) => void
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
      href="/bots"
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        open()
      }}
    >
      <IconBotOutline16 className={iconClassName} />
      <span className={labelClassName}>{t('title')}</span>
    </a>
  )
}
/** Render automations above the ordinary composer; all creation and task expansion use conversation approval.
 * @param props - session input actions, locale, and authenticated management operations.
 * @returns the automation page and capability-gated starter catalogue.
 */
export function AutomationsPanel({ t, inputActions, list, call, openRun, view, showView, services, openConnector, useGeneration }: PropsRuntime<'conversation.start'> & PropsLocale<'automations'> & InjectFace<AutomationPanelInjected>) {
  const connected = useGeneration(generation => generation !== undefined)
  const [data, setData] = useState<AutomationList | null>(lastList)
  const tab = view
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [refresh, setRefresh] = useState(0)
  /** Credential of the one expanded automation, read on demand and dropped when it folds. */
  const [credential, setCredential] = useState<{ id: string; value: WebhookCredential } | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!connected) return
    let alive = true
    const load = (): void => {
      void list()
        .then((value) => { lastList = value; if (alive) { setData(value); setError('') } })
        .catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : t('error')) })
    }
    load()
    const timer = setInterval(load, 5000)
    return () => { alive = false; clearInterval(timer) }
  }, [connected, list, refresh, t])
  const [serviceState, setServiceState] = useState<ServiceState | null>(null)
  /** Service groups a shown starter needs and the account has not connected. */
  const missing = (needs: readonly ServiceNeed[]): ServiceNeed[] => serviceState === null
    ? []
    : needs.filter(need => !SERVICE_NEEDS[need].some(provider => serviceState.connected.has(provider)))
  const anyMissing = TEMPLATE_CATEGORIES.some(category => category.templates.some(template => missing(template.needs).length > 0))
  useEffect(() => {
    if (!connected) return
    let alive = true
    const load = (): void => {
      void services()
        .then((value) => { if (alive) setServiceState(value) })
        // A failed read keeps the last known state; the page stays usable without Connect actions.
        .catch((): void => undefined)
    }
    load()
    // Connecting happens in Settings or in a provider's consent window, so re-read on return
    // and, while a starter still lacks an account, at a slow interval.
    window.addEventListener('focus', load)
    const timer = anyMissing ? setInterval(load, 15000) : undefined
    return () => { alive = false; window.removeEventListener('focus', load); clearInterval(timer) }
  }, [connected, services, anyMissing])
  // The key arrives only for the open card, so a page nobody is looking at holds none.
  useEffect(() => {
    if (!connected || expanded === null || credential?.id === expanded) return
    if (data?.definitions.find(candidate => candidate.id === expanded)?.webhook !== true) return
    let alive = true
    void call('webhook-secret', { id: expanded })
      .then((value) => { if (alive) setCredential({ id: expanded, value: value as WebhookCredential }) })
      // A refused read leaves the card offering its own actions; the next open reads again.
      .catch((): void => undefined)
    return () => { alive = false }
  }, [connected, expanded, credential, data, call])
  const act = (operation: string, id?: string, patch?: object): void => {
    setBusy(true); setError('')
    void call(operation, id === undefined ? {} : patch === undefined ? { id } : { id, patch })
      .then(() => { setRefresh(value => value + 1) })
      .catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : t('error')) })
      .finally(() => { setBusy(false) })
  }
  const date = (at: string): string => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  /** Local sentence for one stored recurrence, shown above the task it runs. */
  const describe = (schedule: TaskSchedule): string => {
    const clock = (wall: string): string => {
      const [hour = 0, minute = 0] = wall.split(':').map(Number)
      return new Date(2023, 0, 1, hour, minute).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    }
    const span = (value: number, unit: 'minute' | 'hour'): string =>
      new Intl.NumberFormat(undefined, { style: 'unit', unit, unitDisplay: 'long' }).format(value)
    const weekday = (day: string): string =>
      new Date(2023, 0, 1 + Math.max(0, ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].indexOf(day))).toLocaleDateString(undefined, { weekday: 'long' })
    const until = schedule.until === undefined ? '' : t('scheduleUntil', { date: date(schedule.until) })
    switch (schedule.kind) {
      case 'once': return `${t('scheduleOnce', { when: date(schedule.at) })}${until}`
      case 'interval': return `${t('scheduleInterval', { duration: span(schedule.everyMinutes, 'minute') })}${until}`
      case 'hours': return `${t('scheduleHours', { duration: span(schedule.everyHours, 'hour'), minute: String(schedule.atMinute) })}${until}`
      case 'daily': return `${t('scheduleDaily', { time: clock(schedule.time) })}${until}`
      case 'weekly': return `${t('scheduleWeekly', { day: schedule.weekdays.map(weekday).join(', '), time: clock(schedule.time) })}${until}`
      case 'monthly': return `${t('scheduleMonthly', { days: schedule.days.join(', '), time: clock(schedule.time) })}${until}`
      case 'nth-weekday': return `${t('scheduleNthWeekday', {
        week: t(`week${schedule.week}`),
        day: weekday(schedule.weekday), time: clock(schedule.time),
      })}${until}`
      case 'yearly': return `${t('scheduleYearly', {
        date: new Date(2023, schedule.month - 1, schedule.day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }),
        time: clock(schedule.time),
      })}${until}`
      case 'cron': return `${t('scheduleCron', { expression: schedule.expression })}${until}`
    }
  }
  /** Absolute address an outside service posts to; a non-HTTP shell shows the path it can reach. */
  const address = (path: string): string => window.location.protocol.startsWith('http') ? `${window.location.origin}${path}` : path
  /** Copy one trigger value and confirm it in place for a moment. */
  const copy = (text: string): void => {
    void writeClipboard(text).then(() => {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 2000)
    })
  }
  const draft = (text: string): void => { inputActions.setDraft(text) }
  /** The page's own confirmation copy, in place of the browser's, for the pending action. */
  const confirmation = (action: PendingAction): { title: string; description: string; confirm: string } => {
    switch (action.kind) {
      case 'clear': return { title: t('clearRuns'), description: t('clearConfirm'), confirm: t('clearRuns') }
      case 'delete': return { title: t('deleteTitle'), description: t('confirmation'), confirm: t('remove') }
      case 'remove-run': return { title: t('removeRun'), description: t('removeRunConfirm'), confirm: t('remove') }
      case 'retry': return { title: t('retry'), description: t('retryWarning'), confirm: t('retry') }
      case 'webhook-rotate': return { title: t('webhookRotateTitle'), description: t('webhookRotateConfirm'), confirm: t('webhookRotate') }
      case 'webhook-remove': return { title: t('webhookRemove'), description: t('webhookRemoveConfirm'), confirm: t('webhookRemove') }
    }
  }
  const confirmed = (action: PendingAction): void => {
    setPending(null)
    switch (action.kind) {
      case 'clear': act('clear'); return
      case 'delete': act('delete', action.id); return
      case 'remove-run': act('remove-run', action.id); return
      case 'retry': act('retry', action.id); return
      case 'webhook-rotate': setCredential(null); act('webhook-rotate', action.id); return
      case 'webhook-remove': setCredential(null); act('webhook-disable', action.id); return
    }
  }
  const pendingCopy = pending === null ? null : confirmation(pending)
  const unavailable = !connected || data === null || busy
  // One equal-height row per run. The row opens the run's conversation, which holds its result and any
  // error; the trailing slot carries the run's status mark, or the retry action that replaces it. The
  // Runs overview gives each finished run its own removal, immediately left of that mark.
  const runRows = (runs: readonly Run[], options: { named: boolean; removable: boolean }) => (
    <ul className={options.named ? css.runCards : css.runList}>
      {runs.map((run) => {
        const retryable = run.resolution === null && (run.status === 'failed' || run.status === 'cancelled' || run.status === 'skipped')
        const finished = run.status !== 'queued' && run.status !== 'running'
        const sessionId = run.sessionId
        return (
          <li className={css.run} key={run.id}>
            <button
              type="button"
              className={css.runOpen}
              disabled={sessionId === null}
              title={run.error ?? undefined}
              onClick={() => { if (sessionId !== null) openRun(sessionId) }}
            >
              <span className={css.runText}>
                <span className={css.runTitle}>{options.named ? run.definition.name : date(run.scheduledFor)}</span>
                <span className={css.runSubtitle}>{options.named ? `${t(run.status)} · ${date(run.scheduledFor)}` : t(run.status)}</span>
              </span>
            </button>
            {options.removable && finished && (
              <Tooltip label={t('removeRun')} side="top" anchor="icon">
                <span className={css.tip}>
                  <Button
                    variant="ghost" size="sm" className={css.runRemove} icon={<IconTrashOutline16 />} aria-label={t('removeRun')}
                    disabled={unavailable} onClick={() => { setPending({ kind: 'remove-run', id: run.id }) }}
                  />
                </span>
              </Tooltip>
            )}
            {retryable ? (
              <Tooltip label={t('retry')} side="top" anchor="icon">
                <span className={css.tip}>
                  <Button
                    variant="ghost" size="sm" className={css.runAction} icon={<IconLucideRotateCcw />} aria-label={t('retry')}
                    disabled={unavailable} onClick={() => { setPending({ kind: 'retry', id: run.id }) }}
                  />
                </span>
              </Tooltip>
            ) : (
              <span className={css.runIcon}>{statusIcon(run.status)}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  /** Local schedule line, e.g. "Weekdays at 7:30 AM"; 2023-01-01 is a Sunday, so day 0 names Sunday. */
  const schedule = (template: AutomationTemplate): string => {
    const [hour = 0, minute = 0] = template.time.split(':').map(Number)
    const time = new Date(2023, 0, 1, hour, minute).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    if (template.days === 'daily') return t('scheduleDaily', { time })
    if (template.days === 'weekdays') return t('scheduleWeekdays', { time })
    return t('scheduleWeekly', { time, day: new Date(2023, 0, 1 + template.days).toLocaleDateString(undefined, { weekday: 'long' }) })
  }
  // The whole tile drafts the starter; its Connect action sits above that hit area.
  const templateCard = (template: AutomationTemplate) => {
    const [need] = missing(template.needs)
    const target = need === undefined ? undefined : SERVICE_NEEDS[need].find(provider => serviceState?.configured.has(provider) === true)
    return (
      <div className={css.template} key={template.id}>
        <button
          type="button" className={css.templateOpen} disabled={unavailable}
          onClick={() => { draft(t(template.draft, { zone, time: template.time })) }}
        >
          <span className={css.templateIcon}><template.icon /></span>
          <span className={css.templateTitle}>{t(template.title)}</span>
          <span className={css.templateDescription}>{t(template.description)}</span>
        </button>
        <span className={css.templateMeta}>
          <span className={css.templateSchedule}><IconLucideClock />{schedule(template)}</span>
          {need !== undefined && (
            <Button variant="primary" size="sm" className={css.templateConnect} icon={<IconPlug />} onClick={() => { openConnector(target) }}>
              {t(CONNECT_LABELS[need])}
            </Button>
          )}
        </span>
      </div>
    )
  }
  return (
    <section className={css.root} aria-label={t('title')}>
      <div className={css.content}>
        <div className={css.bar}>
          <nav className={css.tabs} aria-label={t('title')}>
            <button className={css.tab} aria-pressed={tab === 'automations'} onClick={() => { showView('automations') }}>{t('title')}</button>
            <button className={css.tab} aria-pressed={tab === 'runs'} onClick={() => { showView('runs') }}>{t('history')}</button>
          </nav>
          <Button variant="primary" className={css.headerAction} disabled={unavailable} onClick={() => { draft(t('newDraft')) }}>{t('create')}</Button>
        </div>
        {error && <p role="alert" className={css.alert}>{error}</p>}
        {data === null ? <div className={css.empty}><p className={css.state}>{t(connected ? 'loading' : 'offlineDetail')}</p></div> : tab === 'automations' ? (
          <>
            {data.definitions.length === 0 && (
              <div className={css.empty}>
                <IconBotOutline16 className={css.emptyIcon} />
                <h3 className={css.emptyTitle}>{t('empty')}</h3>
                <p className={css.emptyText}>{t('emptyDetail')}</p>
              </div>
            )}
            <div className={css.list}>
              {data.definitions.map((task) => {
                const hook = credential?.id === task.id ? credential.value : null
                return (
                  <article className={css.card} key={task.id}>
                    <button
                      className={css.toggle}
                      aria-expanded={expanded === task.id}
                      onClick={() => {
                        const next = expanded === task.id ? null : task.id
                        setExpanded(next)
                        setCredential(null)
                        setCopied(false)
                      }}
                    >
                      <span className={css.title}>
                        {task.name}
                        <IconChevronDownOutline14 className={css.chevron} />
                      </span>
                      <span className={css.facts}>
                        <span className={css.fact}>
                          <span className={css.factLabel}>{t('next')}</span>
                          <span className={css.factValue}>
                            {task.status === 'paused' ? t('paused') : task.nextRunAt === null ? t('noNext') : date(task.nextRunAt)}
                          </span>
                        </span>
                        <span className={css.fact}>
                          <span className={css.factLabel}>{t('last')}</span>
                          <span className={css.factValue}>
                            {task.lastRun === null ? t('noRuns') : `${t(task.lastRun.status)} · ${date(task.lastRun.scheduledFor)}`}
                          </span>
                        </span>
                      </span>
                    </button>
                    {expanded === task.id && (
                      <div className={css.details}>
                        <p className={css.schedule}>{describe(task.schedule)}</p>
                        <p className={css.prompt}>{task.prompt}</p>
                      </div>
                    )}
                    {expanded === task.id && data.capabilities.webhook && (
                      <>
                        <h3 className={css.detailTitle}>{t('webhookTitle')}</h3>
                        <p className={css.triggerText}>{task.webhook ? t('webhookActive') : t('webhookIdle')}</p>
                        {task.webhook ? (
                          <>
                            <div className={css.triggerRow}>
                              <span className={css.triggerLabel}>{t('webhookAddress')}</span>
                              <span className={css.triggerValue}>{hook === null ? '…' : address(hook.path)}</span>
                              <Tooltip label={t('webhookCopyAddress')} side="top" anchor="icon">
                                <span className={css.tip}>
                                  <Button
                                    variant="ghost" size="sm" icon={<IconCopyOutline16 />} aria-label={t('webhookCopyAddress')}
                                    disabled={unavailable || hook === null} onClick={() => { if (hook !== null) copy(address(hook.path)) }}
                                  />
                                </span>
                              </Tooltip>
                            </div>
                            <div className={css.triggerRow}>
                              <span className={css.triggerLabel}>{t('webhookKey')}</span>
                              <span className={css.triggerValue}>{hook === null ? '…' : `${hook.keyId}${'•'.repeat(24)}`}</span>
                              <Tooltip label={t('webhookCopyKey')} side="top" anchor="icon">
                                <span className={css.tip}>
                                  <Button
                                    variant="ghost" size="sm" icon={<IconCopyOutline16 />} aria-label={t('webhookCopyKey')}
                                    disabled={unavailable || hook === null} onClick={() => { if (hook !== null) copy(hook.secret) }}
                                  />
                                </span>
                              </Tooltip>
                            </div>
                            <div className={css.triggerActions}>
                              <Button variant="ghost" size="sm" disabled={unavailable} onClick={() => { setPending({ kind: 'webhook-rotate', id: task.id }) }}>
                                {t('webhookRotate')}
                              </Button>
                              <Button variant="ghost" size="sm" disabled={unavailable} onClick={() => { setPending({ kind: 'webhook-remove', id: task.id }) }}>
                                {t('webhookRemove')}
                              </Button>
                              {copied && <span className={css.copied} role="status">{t('webhookCopied')}</span>}
                            </div>
                          </>
                        ) : (
                          <Button variant="primary" size="sm" disabled={unavailable} onClick={() => { act('webhook-enable', task.id) }}>
                            {t('webhookCreate')}
                          </Button>
                        )}
                      </>
                    )}
                    {expanded === task.id && data.runs.some(run => run.definition.id === task.id) && (
                      <>
                        <h3 className={css.detailTitle}>{t('recentRuns')}</h3>
                        {runRows(data.runs.filter(run => run.definition.id === task.id), { named: false, removable: false })}
                      </>
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
                            onClick={() => { setPending({ kind: 'delete', id: task.id }) }}
                          />
                        </span>
                      </Tooltip>
                      <span className={css.status} data-tone={task.status}>{t(task.status)}</span>
                    </div>
                  </article>
                )
              })}
            </div>
            <h2 className={css.sectionTitle}>{t('recommended')}</h2>
            <button type="button" className={css.forYou} disabled={unavailable} onClick={() => { draft(t('forYouDraft')) }}>
              <span className={css.templateIcon}><IconSparkles /></span>
              <span className={css.templateText}>
                <span className={css.templateTitle}>{t('forYouTitle')}</span>
                <span className={css.templateDescription}>{t('forYouDescription')}</span>
              </span>
            </button>
            {TEMPLATE_CATEGORIES.map((category) => {
              const shown = category.templates.filter(template => data.capabilities.triggers.includes(templateTrigger(template.days)))
              if (shown.length === 0) return null
              return (
                <section className={css.category} key={category.title} aria-label={t(category.title)}>
                  <h3 className={css.categoryTitle}>{t(category.title)}</h3>
                  <div className={css.templates}>
                    {shown.map(template => templateCard(template))}
                  </div>
                </section>
              )
            })}
            {anyMissing && (
              <div className={css.connect}>
                <span className={css.connectIcon}><IconPlug /></span>
                <span className={css.templateText}>
                  <span className={css.templateTitle}>{t('connectTitle')}</span>
                  <span className={css.templateDescription}>{t('connectDetail')}</span>
                </span>
                <Button variant="primary" size="sm" className={css.connectAction} onClick={() => { openConnector() }}>{t('connectAction')}</Button>
              </div>
            )}
          </>
        ) : (
          <>
            {data.runs.length === 0 && <div className={css.empty}><p className={css.emptyText}>{t('noRuns')}</p></div>}
            {data.runs.length > 0 && runRows(data.runs, { named: true, removable: true })}
            {data.runs.length > 0 && (
              <div className={css.clearRow}>
                <Button
                  variant="primary" size="sm" icon={<IconTrashOutline16 />} disabled={unavailable}
                  onClick={() => { setPending({ kind: 'clear' }) }}
                >
                  {t('clearRuns')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      {pending !== null && pendingCopy !== null && (
        <Modal
          open onClose={() => { setPending(null) }} closeLabel={t('close')}
          title={pendingCopy.title} description={pendingCopy.description}
          footer={(
            <>
              <Button variant="ghost" onClick={() => { setPending(null) }}>{t('cancel')}</Button>
              <Button variant="primary" disabled={unavailable} onClick={() => { confirmed(pending) }}>{pendingCopy.confirm}</Button>
            </>
          )}
        />
      )}
    </section>
  )
}
