import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { JobsSnapshot, JobView, ObservedJob } from '@aeven/api-job-controller/client'
import type { SessionId } from '@aeven/session/types'
import {
  Button, CopyIconButton, IconChevronDownOutline14, IconStopFill16, Modal, Spinner, StateDot, useAnchoredPosition, useDismissOnOutsidePointer,
  type StateDotState,
} from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@aeven/client-ui-slots'
import { NS } from './locales.ts'
import type {} from '@aeven/client-ui-conversation/client'
import css from './JobListAction.module.css'

/** Registration-side business face for the job list. */
export interface JobListInjected {
  hooks: {
    /** Client jobs snapshot (rosters and observations) bound by the renderer as useJobs. */
    jobs: {
      getSnapshot(): JobsSnapshot
      subscribe(listener: () => void): () => void
    }
  }
  /**
   * Keep one session's roster current while the list is mounted; returns the
   * stop function. Reference-counted by the client service.
   */
  watchRows: (sessionId: SessionId) => () => void
  /**
   * Start observing one job's live output; returns the stop function.
   * Reference-counted by the client service, so panels can overlap safely.
   */
  observe: (sessionId: SessionId | undefined, id: JobView['id']) => () => void
  /**
   * Kill one background job on the human's behalf. Resolves `true` when the
   * registry admitted the request (`requested` or `already-finished`); row
   * state itself converges through the jobs control frames.
   */
  killJob: (sessionId: SessionId, jobId: string) => Promise<boolean>
  /**
   * Remove one finished job from the session's list for good (Clear).
   * Resolves `true` when the registry dropped it; the row leaves through the
   * roster stream.
   */
  removeJob: (sessionId: SessionId, jobId: string) => Promise<boolean>
}

/** Full props for the session-header job-list action. */
export type JobListActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>
  & InjectFace<JobListInjected>

/** Stable empty list so a session with no jobs keeps one array identity. */
const NO_JOBS: readonly JobView[] = []

/** Minimum gap kept between the popover and the viewport edges (the Menu primitive's portal margin). */
const VIEWPORT_MARGIN = 12

/** How long a failed kill keeps its hint before the button resets. */
const KILL_FAILED_MS = 4_000


function isLive(job: JobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/**
 * Whether opening the row starts an output observation stream: a live job's
 * output may still arrive, and a settled one may still hold retained output.
 * This gates the stream only — every row folds out, because the facts, the
 * command, and how the job ended are the whole story of one that printed
 * nothing (a background subagent owns no output of its own).
 */
function hasOutputStream(job: JobView): boolean {
  return isLive(job) || job.output.total > 0
}

/** The one-line qualifier beside the status: live progress while running, the terminal reason once settled. */
function jobDetail(job: JobView): string | undefined {
  return job.progress ?? job.detail
}

/** Closed-union exhaustiveness fence for the wire status set. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a status is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled job status: ${JSON.stringify(value)}`)
}

/**
 * Status marker semantics for a row that shows a still dot: `stopping` and
 * `killed` share the attention color, both meaning the work ended (or is
 * ending) on request rather than on its own. A running row turns the loading
 * mark instead, so it never reaches this map.
 */
function dotState(status: Exclude<JobView['status'], 'running'>): StateDotState {
  switch (status) {
    case 'stopping': return 'warning'
    case 'completed': return 'done'
    case 'killed': return 'warning'
    case 'failed': return 'error'
    /* v8 ignore next -- closed wire status union */
    default: return assertNever(status)
  }
}

function statusLabel(status: JobView['status'], t: TranslateNS<typeof NS>): string {
  switch (status) {
    case 'running': return t('status.running')
    case 'stopping': return t('status.stopping')
    case 'completed': return t('status.completed')
    case 'killed': return t('status.killed')
    case 'failed': return t('status.failed')
    /* v8 ignore next -- closed wire status union */
    default: return assertNever(status)
  }
}

/**
 * The job's everyday name: the known producer kinds read as product words;
 * a kind this build does not know (the map is merge-extensible) shows its id
 * capitalized.
 */
function kindName(kind: string, t: TranslateNS<typeof NS>): string {
  switch (kind) {
    case 'bash': return t('kind.bash')
    case 'pwsh': return t('kind.pwsh')
    case 'subagent': return t('kind.subagent')
    case 'workflow': return t('kind.workflow')
    default: return kind.charAt(0).toUpperCase() + kind.slice(1)
  }
}

/** The row's name: the producer's everyday title, else the kind's name. */
function jobName(job: JobView, t: TranslateNS<typeof NS>): string {
  return job.title ?? kindName(job.kind, t)
}

/**
 * How long ago a settled job ended, in the coarse words a person uses: under
 * a minute reads as "just now", then minutes, hours, and days.
 */
function formatAgo(elapsedMs: number, t: TranslateNS<typeof NS>): string {
  const minutes = Math.floor(Math.max(0, elapsedMs) / 60_000)
  if (minutes < 1) return t('ago.now')
  if (minutes < 60) return t('ago.minutes', { n: pad(minutes) })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t(hours === 1 ? 'ago.hour' : 'ago.hours', { n: pad(hours) })
  const days = Math.floor(hours / 24)
  return t(days === 1 ? 'ago.day' : 'ago.days', { n: pad(days) })
}

/** The stop button's words for each step of its two-press confirmation. */
function killKey(state: KillState): 'kill.stop' | 'kill.pending' | 'kill.failed' {
  switch (state) {
    case 'idle': return 'kill.stop'
    case 'pending': return 'kill.pending'
    case 'failed': return 'kill.failed'
    /* v8 ignore next -- closed kill-state union */
    default: return assertNever(state)
  }
}

/**
 * Elapsed time in at most two adjacent units. A job that outlives an hour is
 * already exceptional, so hours is the widest unit — beyond that the figure
 * stays in hours rather than growing a day/month vocabulary no producer
 * currently reaches.
 */
function formatDuration(elapsedMs: number, t: TranslateNS<typeof NS>): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1_000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3_600)
  if (hours > 0) return t('duration.hours', { hours: pad(hours), minutes: pad(minutes) })
  if (minutes > 0) return t('duration.minutes', { minutes: pad(minutes), seconds: pad(seconds) })
  return t('duration.seconds', { seconds: pad(seconds) })
}

/** Two-digit zero padding, so figures keep one width as they tick. */
function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Live rows first, newest start first; then settled rows, newest finish
 * first. Two rows that settled in the same millisecond fall back to newest
 * start, so the sort never depends on the host's map iteration.
 */
function ordered(jobs: readonly JobView[]): JobView[] {
  return [...jobs].sort((left, right) => {
    const liveLeft = isLive(left)
    if (liveLeft !== isLive(right)) return liveLeft ? -1 : 1
    if (liveLeft) return right.startedAt - left.startedAt
    const finished = (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt)
    return finished !== 0 ? finished : right.startedAt - left.startedAt
  })
}

/**
 * Stop button state: `pending` covers the in-flight RPC until the row's own
 * status flip removes the button, `failed` shows briefly after a rejected kill.
 */
type KillState = 'idle' | 'pending' | 'failed'

/** Wall-clock time of day in the reader's locale, to the minute, on the 24-hour clock Aeven uses. */
function clockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/** One labelled fact in a job's details list. */
interface JobFact {
  readonly label: string
  readonly value: string
}

/**
 * A disclosure card in a job's details: its header toggles the body and,
 * once open, offers a copy of the card's text.
 */
function DetailCard({ title, open, onToggle, copyText, t, children }: {
  title: string
  open: boolean
  onToggle: () => void
  /** The text the header copies while the card is open; empty offers no copy. */
  copyText: string
  t: TranslateNS<typeof NS>
  children: ReactNode
}) {
  return (
    <div className={css.card}>
      <div className={css.cardHeader}>
        <button type="button" className={css.cardToggle} aria-expanded={open} onClick={onToggle}>
          {title}
          <IconChevronDownOutline14 className={open ? `${css.sectionChevron} ${css.sectionChevronOpen}` : css.sectionChevron} />
        </button>
        {open && copyText !== ''
          ? <CopyIconButton text={copyText} label={t('terminal.copy')} copiedLabel={t('terminal.copied')} />
          : null}
      </div>
      {open ? children : null}
    </div>
  )
}

/**
 * A job's details, revealed step by step inside the opened row's group: the
 * full name, a two-column list of plain facts, then what the job printed and
 * the command, each in a card that opens on request. The output follows the
 * newest line while the reader stays at the bottom.
 */
function JobDetails({ job, view, live, facts, t }: {
  job: JobView
  view: ObservedJob | undefined
  live: boolean
  facts: readonly JobFact[]
  t: TranslateNS<typeof NS>
}) {
  const [showOutput, setShowOutput] = useState(false)
  const [showCommand, setShowCommand] = useState(false)
  const outputRef = useRef<HTMLPreElement>(null)
  const followRef = useRef(true)
  const text = view?.text ?? ''
  useLayoutEffect(() => {
    const output = outputRef.current
    if (output !== null && followRef.current) output.scrollTop = output.scrollHeight
  }, [text, showOutput])
  return (
    <div className={css.panel}>
      <dl className={css.facts}>
        {facts.map(fact => (
          <div key={fact.label} className={css.fact}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      <div className={css.cards}>
        <DetailCard
          title={t('panel.output')}
          open={showOutput}
          onToggle={() => { setShowOutput(current => !current) }}
          copyText={text}
          t={t}
        >
          {view?.error !== undefined
            ? <div className={`${css.cardEmpty} ${css.noticeError}`}>{t('output.error', { error: view.error })}</div>
            : null}
          {text !== ''
            ? (
              <pre
                ref={outputRef}
                className={`${css.cardBody} no-scrollbar`}
                onScroll={(event) => {
                  const output = event.currentTarget
                  followRef.current = output.scrollHeight - output.scrollTop - output.clientHeight < 8
                }}
              >
                {view?.gapBefore === true ? <span className={css.cardGap}>{t('output.gap')}{'\n'}</span> : null}
                {text}
              </pre>
            )
            : <div className={css.cardEmpty}>{t(live ? 'panel.waiting' : 'panel.noOutput')}</div>}
        </DetailCard>
        <DetailCard
          title={t('panel.command')}
          open={showCommand}
          onToggle={() => { setShowCommand(current => !current) }}
          copyText={job.label}
          t={t}
        >
          <pre className={`${css.cardBody} ${css.commandBody} no-scrollbar`}>{job.label}</pre>
        </DetailCard>
      </div>
    </div>
  )
}

/** One job row plus, while expanded, its details. */
function JobItem({ job, view, expanded, now, onToggle, kill, t }: {
  job: JobView
  view: ObservedJob | undefined
  expanded: boolean
  /** Clock sample live rows derive their running duration from. */
  now: number
  onToggle: () => void
  /** Present on running rows: the human-kill button state and press handler. */
  kill?: { state: KillState; onPress: () => void }
  t: TranslateNS<typeof NS>
}) {
  const live = isLive(job)
  const status = statusLabel(job.status, t)
  const detail = jobDetail(job)
  const finishedAt = job.finishedAt ?? job.startedAt
  const duration = formatDuration((live ? now : finishedAt) - job.startedAt, t)
  // A live row counts up its run time; a settled one says when it ended, and
  // its run time moves into the foldout.
  const timeCell = live
    ? <span className={css.duration} title={t('duration.title.live', { duration })}>{duration}</span>
    : (
      <span className={css.duration} title={new Date(finishedAt).toLocaleString()}>
        {formatAgo(now - finishedAt, t)}
      </span>
    )
  const facts: JobFact[] = [
    { label: t('facts.started'), value: clockTime(job.startedAt) },
    ...live
      ? [{ label: t('facts.runningFor'), value: duration }]
      : [
        { label: t('facts.ended'), value: `${clockTime(finishedAt)} · ${formatAgo(now - finishedAt, t)}` },
        { label: t('facts.ranFor'), value: duration },
        { label: t('facts.result'), value: status },
      ],
    ...detail !== undefined ? [{ label: t(live ? 'facts.progress' : 'facts.details'), value: detail }] : [],
  ]
  // A running job turns the Aeven loading mark, as a running chat does in the
  // sidebar; every other state is a still dot.
  const marker = job.status === 'running'
    ? <Spinner className={css.rowSpinner} />
    : (
      <StateDot
        state={dotState(job.status)}
        // Stopping a job on purpose is ordinary, not a warning.
        className={job.status === 'killed' ? `${css.rowDot} ${css.rowDotNeutral}` : css.rowDot}
      />
    )
  // Without a stop control the chevron takes the stop icon's column.
  const chevron = [css.chevron, kill === undefined ? css.chevronEnd : '', expanded ? css.chevronOpen : '']
    .filter(Boolean).join(' ')
  const name = jobName(job, t)
  // One Menu cell in plain words: what the job does, and for how long (a
  // settled one says how and when it ended). The command, output, and
  // technical detail wait in the foldout, which every row has: a job that
  // printed nothing still has its command, its run time, and its result.
  // Opened, the row becomes the details' title: the full name alone, since
  // the state and the time are listed in the facts below it.
  const body = expanded
    ? (
      <>
        <span className={`${css.label} ${css.labelOpen}`}>{name}</span>
        <span className={css.spacer} />
        <span className={chevron} aria-hidden><IconChevronDownOutline14 /></span>
      </>
    )
    : (
      <>
        {marker}
        <span className={css.label} title={name}>{name}</span>
        {live ? null : <span className={css.status}>{status}</span>}
        <span className={css.spacer} />
        {timeCell}
        <span className={chevron} aria-hidden><IconChevronDownOutline14 /></span>
      </>
    )
  return (
    <li className={expanded ? `${css.item} ${css.itemOpen}` : css.item}>
      <div className={css.rowLine}>
        <button
          type="button"
          className={kill === undefined ? css.row : `${css.row} ${css.rowWithStop}`}
          aria-expanded={expanded}
          aria-label={t(expanded ? 'row.collapseAria' : 'row.expandAria', { label: name })}
          onClick={onToggle}
        >
          {body}
        </button>
        {kill !== undefined
          ? (
            // Icon only; the press asks for confirmation in a dialog.
            <button
              type="button"
              className={
                kill.state === 'failed' ? `${css.stop} ${css.stopFailed}` : css.stop
              }
              data-kill-state={kill.state}
              disabled={kill.state === 'pending'}
              aria-label={t(killKey(kill.state))}
              title={t(killKey(kill.state))}
              onClick={kill.onPress}
            >
              <IconStopFill16 size={12} />
            </button>
          )
          : null}
      </div>
      {/* The foldout opens at once; output fills in when the observation
          stream delivers it. */}
      {expanded
        ? <JobDetails job={job} view={view} live={live} facts={facts} t={t} />
        : null}
    </li>
  )
}

/**
 * Session-header entry point for this session's background jobs. Mounting it
 * keeps the session's roster stream open; it renders nothing at all until the
 * session can see at least one job. Every row folds out into its facts, its
 * command, and its output; expanding a row that still has output (a live job,
 * or a settled one with retained output) also starts its observation stream,
 * and collapsing (or closing the popover) stops it — output only flows while
 * someone is watching. A running row carries a two-press stop button that
 * requests a human kill through the job controller.
 * @param props - runtime slot currency, the jobs snapshot hook, the roster,
 *   observation, and kill controls, and the namespace translator.
 * @returns the trigger and its popover list, or null when there is nothing to show.
 */
export function JobListAction({ sessionId, useJobs, watchRows, observe, killJob, removeJob, t }: JobListActionProps) {
  const jobs = useJobs(state => state.rows[sessionId]) ?? NO_JOBS
  const observedViews = useJobs(state => state.observed)
  const [open, setOpen] = useState(false)
  const [expandedKey, setExpandedKey] = useState<string | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())
  // Settled-section fold: an explicit user toggle wins; before one, the tail
  // folds only while live work exists (a settled-only list opens expanded).
  const [settledOpen, setSettledOpen] = useState<boolean | undefined>(undefined)
  // Rows the user cleared, hidden until the roster stream confirms their
  // removal from the registry.
  const [clearedKeys, setClearedKeys] = useState<ReadonlySet<string>>(() => new Set())
  // The running job whose stop waits for the dialog's confirmation.
  const [confirmJob, setConfirmJob] = useState<JobView | undefined>(undefined)
  // The one row whose stop is in flight or just failed.
  const [killPhase, setKillPhase] = useState<{ key: string; state: Exclude<KillState, 'idle'> } | undefined>(undefined)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)

  const rows = useMemo(() => ordered(jobs), [jobs])
  const liveRows = useMemo(() => rows.filter(isLive), [rows])
  const settledRows = useMemo(
    () => rows.filter(job => !isLive(job) && !clearedKeys.has(String(job.id))),
    [rows, clearedKeys],
  )
  const settledExpanded = settledOpen ?? liveRows.length === 0
  const visibleCount = liveRows.length + settledRows.length

  // The body-portaled confirmation sits outside the root; while it shows, a
  // press in it must not close the list behind it.
  useDismissOnOutsidePointer(rootRef, open && confirmJob === undefined, setOpen, menuRef)
  const menuPosition = useAnchoredPosition({ open, anchorRef: rootRef, panelRef: menuRef, gap: 8, margin: VIEWPORT_MARGIN })

  // The roster follows the mounted session: one stream while this control
  // lives, released with it.
  useEffect(() => watchRows(sessionId), [sessionId, watchRows])

  // The clock only runs while the list is open: every second while a run
  // time counts up, otherwise often enough for "5 min ago" to stay true.
  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, liveRows.length > 0 ? 1_000 : 30_000)
    return () => { clearInterval(timer) }
  }, [open, liveRows.length])

  // Observation follows visibility: the stream opens when a row that still has
  // output expands and closes when it collapses, unmounts, or the popover
  // closes. A row with nothing to stream still folds out; only its output card
  // stays quiet.
  const expandedRow = open && expandedKey !== undefined
    ? rows.find(job => String(job.id) === expandedKey)
    : undefined
  const activeJob = expandedRow !== undefined && hasOutputStream(expandedRow) ? expandedRow.id : undefined
  useEffect(() => {
    if (activeJob === undefined) return
    return observe(sessionId, activeJob)
  }, [sessionId, activeJob, observe])

  // The last visible job disappearing removes this control; close first so
  // focus does not vanish from an unmounting node.
  useEffect(() => {
    if (visibleCount === 0 && open) setOpen(false)
  }, [visibleCount, open])

  // An expanded row that left the list (owner disposal) folds its panel.
  useEffect(() => {
    if (expandedKey !== undefined && !rows.some(job => String(job.id) === expandedKey)) {
      setExpandedKey(undefined)
    }
  }, [rows, expandedKey])

  // A failed kill clears its hint on a timer; the pending phase instead waits
  // for the RPC (or the row's own status flip). The cleanup clears the timer
  // on every phase change, so a firing timer always describes the current
  // phase and may reset unconditionally.
  useEffect(() => {
    if (killPhase === undefined || killPhase.state === 'pending') return
    const timer = setTimeout(() => { setKillPhase(undefined) }, KILL_FAILED_MS)
    return () => { clearTimeout(timer) }
  }, [killPhase])

  // A phase whose row stopped being killable (settled, stopping, removed)
  // has no button to describe any more.
  useEffect(() => {
    if (killPhase !== undefined
      && !rows.some(job => String(job.id) === killPhase.key && job.status === 'running')) {
      setKillPhase(undefined)
    }
  }, [rows, killPhase])

  /** Confirm one row's stop: the job the dialog is confirming, closed over by its own button. */
  const confirmKill = (job: JobView): void => {
    setConfirmJob(undefined)
    // The row may have settled while the dialog was open.
    if (rows.some(row => row.id === job.id && row.status === 'running')) pressKill(job)
  }

  const pressKill = (job: JobView): void => {
    const key = String(job.id)
    setKillPhase({ key, state: 'pending' })
    void killJob(sessionId, key).then((ok) => {
      // An admitted kill stays pending: the unary response (HTTP) and the jobs
      // frames (control stream) have no cross-carrier ordering, so re-enabling
      // here could offer a duplicate kill while the row still reads `running`.
      // The authoritative jobs frame flips the row to `stopping`, which removes
      // the button and clears the phase through the killable-set effect above.
      setKillPhase(current => current?.key === key && !ok
        ? { key, state: 'failed' }
        : current)
    })
  }

  if (visibleCount === 0) return null

  const countKey = liveRows.length > 0
    ? (liveRows.length === 1 ? 'count.live.one' : 'count.live.other')
    : (visibleCount === 1 ? 'count.idle.one' : 'count.idle.other')
  const countLabel = t(countKey, { count: liveRows.length > 0 ? liveRows.length : visibleCount })

  // Clear removes the finished jobs from the registry for good; the rows hide
  // at once and leave for real when the roster stream drops them.
  const clearSettled = (): void => {
    setClearedKeys((current) => {
      const next = new Set(current)
      for (const job of settledRows) next.add(String(job.id))
      return next
    })
    for (const job of settledRows) void removeJob(sessionId, String(job.id))
    if (expandedKey !== undefined && settledRows.some(job => String(job.id) === expandedKey)) {
      setExpandedKey(undefined)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Tab' && open && confirmJob === undefined) {
      const trigger = triggerRef.current
      const menu = menuRef.current
      if (trigger === null || menu === null) return
      const focusable = [...menu.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')]
      if (event.target === trigger && !event.shiftKey) {
        event.preventDefault()
        focusable[0]?.focus()
      } else if (event.shiftKey ? event.target === focusable[0] : event.target === focusable.at(-1)) {
        if (event.shiftKey) event.preventDefault()
        trigger.focus()
      }
      return
    }
    // The dialog handles its own Escape; its React events bubble here.
    if (event.key !== 'Escape' || !open || confirmJob !== undefined) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }

  const item = (job: JobView) => (
    <JobItem
      key={String(job.id)}
      job={job}
      view={observedViews[String(job.id)]}
      expanded={expandedKey === String(job.id)}
      now={now}
      onToggle={() => {
        setExpandedKey(current => current === String(job.id) ? undefined : String(job.id))
      }}
      {...job.status === 'running'
        ? {
          kill: {
            state: killPhase?.key === String(job.id) ? killPhase.state : 'idle' as const,
            onPress: () => { setConfirmJob(job) },
          },
        }
        : {}}
      t={t}
    />
  )

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={countLabel}
        onClick={() => {
          // Sample the clock in the same commit that opens the list: the
          // mount-time value predates every job, so the first painted frame
          // would otherwise clamp a long-running row to zero until the
          // open effect corrects it a frame later.
          setNow(Date.now())
          setOpen(current => !current)
        }}
      >
        {liveRows.length > 0 ? <Spinner className={css.triggerSpinner} /> : null}
        <span className={css.count}>{countLabel}</span>
        <span className={open ? `${css.triggerChevron} ${css.triggerChevronOpen}` : css.triggerChevron} aria-hidden>
          <IconChevronDownOutline14 size={12} />
        </span>
      </button>
      {open
        ? createPortal(
          <ul ref={menuRef} className={css.menu} style={menuPosition ?? { visibility: 'hidden', left: 0, top: 0 }} aria-label={t('list.aria')}>
            {liveRows.map(item)}
            {settledRows.length > 0
              ? (
                <li className={css.sectionHeader}>
                  <button
                    type="button"
                    className={css.sectionToggle}
                    aria-expanded={settledExpanded}
                    onClick={() => { setSettledOpen(!settledExpanded) }}
                  >
                    {t('section.settledCount', { count: settledRows.length })}
                    <IconChevronDownOutline14 className={settledExpanded ? `${css.sectionChevron} ${css.sectionChevronOpen}` : css.sectionChevron} />
                  </button>
                  <button type="button" className={css.sectionClear} onClick={clearSettled}>
                    {t('section.clear')}
                  </button>
                </li>
              )
              : null}
            {settledExpanded ? settledRows.map(item) : null}
          </ul>,
          document.body,
        )
        : null}
      <Modal
        open={confirmJob !== undefined}
        onClose={() => { setConfirmJob(undefined) }}
        title={t('confirm.title', { name: confirmJob !== undefined ? jobName(confirmJob, t) : '' })}
        description={t('confirm.description')}
        closeLabel={t('confirm.close')}
        className={css.confirm as string}
        footer={confirmJob === undefined
          ? null
          : (
            <>
              <Button variant="outline" className={css.confirmAction} onClick={() => { setConfirmJob(undefined) }}>
                {t('confirm.cancel')}
              </Button>
              <Button variant="primary" className={css.confirmAction} autoFocus onClick={() => { confirmKill(confirmJob) }}>
                {t('confirm.stop')}
              </Button>
            </>
          )}
      />
    </div>
  )
}
