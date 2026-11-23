/** Pieces more than one bot page shows: run rows, the idea gallery, the view switcher, and the sidebar link. */
import {
  Button, IconBotFaceAnimated, IconChevronLeftOutline14, IconEditOutline16, IconLucideCheck, IconLucideChevronDown,
  IconLucideChevronRight, IconLucideClock, IconLucideEllipsisVertical, IconLucideMinus, IconLucidePause, IconLucidePlay,
  IconLucideRotateCcw, IconLucideX,
  IconStopFill16, IconTrashOutline16, Menu, Spinner, Tooltip,
} from '@aeven/client-ui-primitives'
import type { PropsLocale } from '@aeven/client-ui-slots'
import type { SidebarNavOwnerProps } from '@aeven/client-ui-sidebar/client'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import type { Formatters, Translate } from './format.ts'
import { IconPlug, IconSparkles } from './icons.tsx'
import type { AutomationList, AutomationView, Run, ServiceState, Task } from './model.ts'
import type { Automations } from './useAutomations.ts'
import { SERVICE_NEEDS, TEMPLATE_CATEGORIES, templateTrigger, type AutomationTemplate, type ServiceNeed } from './templates.ts'
import type { PendingAction } from './useAutomations.ts'
import css from './AutomationsPanel.module.css'

/** Locale key of each service group's Connect action. */
const CONNECT_LABELS = { mail: 'connectMail', calendar: 'connectCalendar', github: 'connectGithub' } as const satisfies Record<ServiceNeed, string>

/** Address of the bot overview, for links the browser can open in a new tab. */
export const OVERVIEW_PATH = '/bots'

/**
 * Run an in-page navigation for a plain primary click, and leave modified clicks to the browser's own link handling.
 * @param event - the link's click.
 * @param navigate - the in-page navigation.
 */
export function followLink(event: MouseEvent<HTMLAnchorElement>, navigate: () => void): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  navigate()
}

/**
 * Neutral status glyph for a run; outcomes never use alarm colour.
 * @param status - run status.
 * @returns the glyph shown in the run's status mark.
 */
export function statusIcon(status: Run['status']): ReactNode {
  switch (status) {
    case 'queued': return <IconLucideClock />
    case 'running': return <Spinner />
    case 'succeeded': return <IconLucideCheck />
    case 'failed': return <IconLucideX />
    case 'skipped':
    case 'cancelled': return <IconLucideMinus />
  }
}

/**
 * Whether a run ended without doing its work: failed, skipped, or stopped.
 * @param status - run status.
 * @returns true for an outcome the reader should look at.
 */
export function unfinished(status: Run['status']): boolean {
  return status === 'failed' || status === 'skipped' || status === 'cancelled'
}

/** Sidebar navigation callbacks. */
export interface AutomationRowInjected {
  open: () => void
}

/**
 * Open the bot overview while preserving ordinary browser link activation.
 * @param props - sidebar geometry and navigation.
 * @returns an addressable sidebar row.
 */
export function AutomationRow({ rowClassName, iconClassName, labelClassName, open, t }: SidebarNavOwnerProps & AutomationRowInjected & PropsLocale<'automations'>) {
  return (
    <a className={rowClassName} href={OVERVIEW_PATH} onClick={(event) => { followLink(event, open) }}>
      <IconBotFaceAnimated className={iconClassName} />
      <span className={labelClassName}>{t('title')}</span>
    </a>
  )
}

/** Width in rem at or below which a bot card stacks its third recurrence fact on its own row. */
const NARROW_CARD_REM = 30

/**
 * Mark each facts grid at most {@link NARROW_CARD_REM} wide with `data-narrow`, measured on the grid itself: the
 * Safari 14.5 baseline has no container queries.
 * @param refresh - a value whose change means the cards were rendered again.
 * @returns the ref of the element holding the cards.
 */
export function useNarrowCards(refresh: unknown): RefObject<HTMLDivElement> {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = list.current
    if (element === null) return undefined
    const observer = new ResizeObserver((entries) => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
      for (const entry of entries) entry.target.toggleAttribute('data-narrow', entry.contentRect.width <= NARROW_CARD_REM * rem)
    })
    for (const facts of element.querySelectorAll(`.${css.facts}`)) observer.observe(facts)
    return () => { observer.disconnect() }
  }, [refresh])
  return list
}

/**
 * A bot's recurrence facts: when it runs next, its last result, and where it runs once that is decided.
 * @param props - the bot and the formatters.
 * @returns the facts grid.
 */
export function Facts({ t, fmt, task }: { t: Translate; fmt: Formatters; task: Task }) {
  return (
    <span className={css.facts}>
      <span className={css.fact}>
        <span className={css.factLabel}>{t('next')}</span>
        <span className={css.factValue}>{fmt.next(task)}</span>
      </span>
      <span className={css.fact}>
        <span className={css.factLabel}>{t('last')}</span>
        <span className={css.factValue}>
          {task.lastRun === null ? t('noRuns') : `${t(task.lastRun.status)} · ${fmt.date(task.lastRun.scheduledFor)}`}
        </span>
      </span>
      {task.placement.runsOn !== 'any' && (
        <span className={css.fact}>
          <span className={css.factLabel}>{t('runsOn')}</span>
          <span className={css.factValue}>{fmt.runsOn(task)}</span>
        </span>
      )}
    </span>
  )
}

/**
 * Run now, or Stop while a run of the bot is queued or running.
 * @param props - the bot, its active run, and the shared operations.
 * @returns the card's primary action.
 */
export function RunControl({ t, task, current, state }: { t: Translate; task: Task; current: Run | undefined; state: Automations }) {
  return current === undefined ? (
    <Button variant="primary" size="sm" className={css.runNow} icon={<IconLucidePlay />} disabled={state.unavailable} onClick={() => { state.send('run', { id: task.id }) }}>
      {t('run')}
    </Button>
  ) : (
    <Button variant="primary" size="sm" className={css.runNow} icon={<IconStopFill16 />} disabled={!state.connected} onClick={() => { state.stop(current.id) }}>
      {t('stop')}
    </Button>
  )
}

/**
 * Pause an active bot or resume a paused one.
 * @param props - the bot and the shared operations.
 * @returns the card's pause action.
 */
export function PauseControl({ t, task, state }: { t: Translate; task: Task; state: Automations }) {
  const label = t(task.status === 'active' ? 'pause' : 'resume')
  return (
    <Tooltip label={label} side="top" anchor="icon">
      <span className={css.tip}>
        <Button
          variant="ghost" size="sm" className={`${css.action} ${css.iconAction}`}
          icon={task.status === 'active' ? <IconLucidePause /> : <IconLucidePlay />}
          aria-label={label} disabled={state.unavailable}
          onClick={() => { state.send('update', { id: task.id, patch: { status: task.status === 'active' ? 'paused' : 'active' } }) }}
        />
      </span>
    </Tooltip>
  )
}

/**
 * The bot's options menu, opening like the other options menus: Edit puts the caret in the bot's own composer, and
 * Delete asks in the page's own dialog.
 * @param props - the bot, the shared operations, the edit action, and what follows a confirmed delete.
 * @returns the options button and its menu.
 */
export function BotMenu({ t, task, state, edit, deleted }: {
  t: Translate
  task: Task
  state: Automations
  edit: (id: string) => void
  deleted?: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open} portal closeOnPointerLeave
      onClose={() => { setOpen(false) }}
      items={[
        { id: 'edit', label: t('edit'), icon: <IconEditOutline16 /> },
        { id: 'delete', label: t('remove'), icon: <IconTrashOutline16 />, disabled: state.unavailable },
      ]}
      onSelect={(choice) => {
        setOpen(false)
        if (choice === 'edit') edit(task.id)
        if (choice === 'delete') state.setPending(deleted === undefined ? { kind: 'delete', id: task.id } : { kind: 'delete', id: task.id, done: deleted })
      }}
      anchor={(
        <Tooltip label={t('more')} side="top" anchor="icon">
          <span className={css.tip}>
            <Button
              variant="ghost" size="sm" className={`${css.action} ${css.iconAction}`} icon={<IconLucideEllipsisVertical />}
              aria-label={t('more')} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}
            />
          </span>
        </Tooltip>
      )}
    />
  )
}

/**
 * The bot's state at the end of its actions row: active, paused or the run that paused it, or stopping once a stop
 * was sent.
 * @param props - the bot, its active run, and the shared operations.
 * @returns the status pill.
 */
export function StatusPill({ t, fmt, task, current, state }: {
  t: Translate
  fmt: Formatters
  task: Task
  current: Run | undefined
  state: Automations
}) {
  return current !== undefined && state.stopping.has(current.id)
    ? <span className={css.status} role="status"><Spinner />{t('stopping')}</span>
    : <span className={css.status}>{task.status === 'paused' && task.pausedBy !== undefined ? t('pausedByRun', { time: fmt.moment(task.pausedBy.scheduledFor) }) : t(task.status)}</span>
}

/**
 * The page's control row: the Bots / Runs switcher, or, on one bot's page, the back disc with the Overview action,
 * both returning to the overview.
 * @param props - the open view and navigation.
 * @returns the page's control row.
 */
export function ViewBar({ t, view, showView }: {
  t: Translate
  view: AutomationView
  showView: (view: Exclude<AutomationView, 'bot'>) => void
}) {
  if (view === 'bot') {
    return (
      <div className={css.bar}>
        <button type="button" className={css.disc} aria-label={t('backToBots')} title={t('backToBots')} onClick={() => { showView('overview') }}>
          <IconChevronLeftOutline14 />
        </button>
        <Button variant="primary" className={css.headerAction} onClick={() => { showView('overview') }}>{t('overview')}</Button>
      </div>
    )
  }
  return (
    <div className={css.bar}>
      <nav className={css.tabs} aria-label={t('title')}>
        <button className={css.tab} aria-pressed={view === 'overview'} onClick={() => { showView('overview') }}>{t('title')}</button>
        <button className={css.tab} aria-pressed={view === 'runs'} onClick={() => { showView('runs') }}>{t('history')}</button>
      </nav>
    </div>
  )
}

/** One entry of a run list: a run, or two or more consecutive quiet runs of one bot folded into one row. */
type RunEntry = { kind: 'run'; run: Run } | { kind: 'quiet'; runs: Run[] }

/**
 * Fold every stretch of two or more consecutive quiet runs of the same bot into one entry.
 * @param runs - runs, newest first.
 * @returns the list's entries in the same order.
 */
function foldQuiet(runs: readonly Run[]): RunEntry[] {
  const entries: RunEntry[] = []
  for (const run of runs) {
    const last = entries.at(-1)
    const previous = last?.kind === 'run' ? last.run : last?.runs.at(-1)
    if (run.quiet === true && previous?.quiet === true && previous.definition.id === run.definition.id) {
      if (last?.kind === 'quiet') last.runs.push(run)
      else entries[entries.length - 1] = { kind: 'quiet', runs: [previous, run] }
      continue
    }
    entries.push({ kind: 'run', run })
  }
  return entries
}

/**
 * One equal-height row per run. The row opens the run's conversation, which holds its result and any error; the
 * trailing slot carries the run's status mark, or the retry action that replaces it. The runs list gives each
 * finished run its own removal, immediately left of that mark. Consecutive runs of one bot with nothing new fold
 * into one row that lists them when opened.
 * @param props - the runs, how they are labelled, and the actions they offer.
 * @returns the run list.
 */
export function RunRows({ t, fmt, runs, named, removable, unavailable, openRun, setPending }: {
  t: Translate
  fmt: Formatters
  runs: readonly Run[]
  named: boolean
  removable: boolean
  unavailable: boolean
  openRun: (sessionId: string) => void
  setPending: (action: PendingAction) => void
}) {
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set())
  const row = (run: Run) => {
    const retryable = run.resolution === null && unfinished(run.status)
    const finished = run.status !== 'queued' && run.status !== 'running'
    const sessionId = run.sessionId
    const outcome = run.quiet === true ? t('quiet') : t(run.status)
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
            <span className={css.runTitle}>{named ? run.definition.name : fmt.date(run.scheduledFor)}</span>
            <span className={css.runSubtitle}>
              {named ? `${outcome} · ${fmt.date(run.scheduledFor)}` : outcome}
              {run.usage != null && run.usage.totalTokens > 0 ? ` · ${t('tokens', { n: fmt.number(run.usage.totalTokens) })}` : ''}
            </span>
          </span>
        </button>
        {removable && finished && (
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
  }
  return (
    <ul className={named ? css.runCards : css.runList}>
      {foldQuiet(runs).map((entry) => {
        if (entry.kind === 'run') return row(entry.run)
        const [newest] = entry.runs
        if (newest === undefined) return null
        const open = unfolded.has(newest.id)
        const oldest = entry.runs.at(-1) ?? newest
        return [
          <li className={css.run} key={`quiet:${newest.id}`}>
            <button
              type="button" className={css.runOpen} aria-expanded={open}
              onClick={() => {
                setUnfolded((current) => {
                  const next = new Set(current)
                  if (open) next.delete(newest.id)
                  else next.add(newest.id)
                  return next
                })
              }}
            >
              <span className={css.runText}>
                <span className={css.runTitle}>{named ? newest.definition.name : `${fmt.date(oldest.scheduledFor)} – ${fmt.date(newest.scheduledFor)}`}</span>
                <span className={css.runSubtitle}>{t('quietGroup', { n: fmt.number(entry.runs.length) })}</span>
              </span>
            </button>
            <span className={css.runIcon}>{open ? <IconLucideChevronDown /> : <IconLucideChevronRight />}</span>
          </li>,
          ...open ? entry.runs.map(row) : [],
        ]
      })}
    </ul>
  )
}

/**
 * Ideas to start a bot from: "Ideas for you", the starters the Host can schedule, and the Connect banner while a
 * starter lacks an account. A tile puts its starter in the composer; nothing is sent until the reader sends it.
 * @param props - the list's capabilities, connector state, and the send and Connect actions.
 * @returns the idea gallery.
 */
export function IdeaGallery({ t, data, serviceState, missing, anyMissing, unavailable, start, openConnector }: {
  t: Translate
  data: AutomationList
  serviceState: ServiceState | null
  missing: (needs: readonly ServiceNeed[]) => ServiceNeed[]
  anyMissing: boolean
  unavailable: boolean
  start: (text: string) => void
  openConnector: (provider?: string) => void
}) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  /** Local schedule line, e.g. "Weekdays at 7:30 AM"; 2023-01-01 is a Sunday, so day 0 names Sunday. */
  const schedule = (template: AutomationTemplate): string => {
    const [hour = 0, minute = 0] = template.time.split(':').map(Number)
    const time = new Date(2023, 0, 1, hour, minute).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    if (template.days === 'daily') return t('scheduleDaily', { time })
    if (template.days === 'weekdays') return t('scheduleWeekdays', { time })
    return t('scheduleWeekly', { time, day: new Date(2023, 0, 1 + template.days).toLocaleDateString(undefined, { weekday: 'long' }) })
  }
  // The whole tile drafts the starter; its Connect action sits above that hit area and only opens Settings.
  const templateCard = (template: AutomationTemplate) => {
    const [need] = missing(template.needs)
    const target = need === undefined ? undefined : SERVICE_NEEDS[need].find(provider => serviceState?.configured.has(provider) === true)
    return (
      <div className={css.template} key={template.id}>
        <button
          type="button" className={css.templateOpen} disabled={unavailable}
          onClick={() => { start(t(template.draft, { zone, time: template.time })) }}
        >
          <span className={css.templateIcon}><template.icon /></span>
          <span className={css.templateTitle}>{t(template.title)}</span>
          <span className={css.templateDescription}>{t(template.description)}</span>
        </button>
        <span className={css.templateMeta}>
          <span className={css.templateSchedule}><IconLucideClock />{schedule(template)}</span>
          {need !== undefined && (
            <button type="button" className={css.templateConnect} onClick={() => { openConnector(target) }}>
              <IconPlug />
              {t(CONNECT_LABELS[need])}
            </button>
          )}
        </span>
      </div>
    )
  }
  return (
    <>
      <h2 className={css.sectionTitle}>{t('recommended')}</h2>
      <button type="button" className={css.forYou} disabled={unavailable} onClick={() => { start(t('forYouDraft')) }}>
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
  )
}
