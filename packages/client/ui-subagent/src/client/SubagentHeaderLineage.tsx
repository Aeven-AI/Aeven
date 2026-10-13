import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type SessionListState, type SessionProjectionMap, type SessionSummary,
  type SubagentCatalogSnapshot,
} from '@aeven/api-session-controller/client'
import type { SubagentAddress } from '@aeven/subagent/client'
import type { SessionId } from '@aeven/session/types'
import {
  ActivityDetails, ActivityItem, ActivityLink, ActivityMenu, ActivityMessage, ActivityNote, ActivityPill,
  ActivitySection, type ActivityFact,
} from '@aeven/client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@aeven/client-ui-slots'
import { NS } from './locales.ts'
import type {} from '@aeven/client-ui-conversation/client'
import type {} from '@aeven/token-meter/client'
import { indexSubagentDescendants } from './subagent-lineage.ts'

type CatalogEntry = SubagentCatalogSnapshot['entries'][number]
type ChildEntry = Extract<CatalogEntry, { kind: 'child' }>
type Catalogs = SessionListState['subagentsByParent']
type Summaries = Readonly<Record<SessionId, SessionSummary>>

/** Business actions supplied by the slot registration. */
export interface SubagentCatalogInjected {
  openChild: (address: SubagentAddress) => void
  /** Open an ordinary Session, the way back from a subagent to its parent. */
  openSession: (sessionId: SessionId) => void
  refresh: (parentSessionId: SessionId) => void
  setCatalogOpen: (parentSessionId: SessionId, open: boolean) => void
}

/** Full props for the session-header lineage renderer. */
export type SubagentHeaderLineageProps =
  PropsRuntime<'conversation.session.header.lineage'> & SubagentCatalogInjected & PropsLocale<typeof NS>

function diagnosticReason(
  entry: Extract<CatalogEntry, { kind: 'diagnostic' }>,
  t: TranslateNS<typeof NS>,
): string {
  switch (entry.reason) {
    case 'corrupt': return t('diagnostic.corrupt')
    case 'unsupported': return t('diagnostic.unsupported')
    case 'unavailable': return t('diagnostic.unavailable')
  }
}

/** Compact token count shared in shape with the conversation stats strip. */
function formatTokens(value: number, t: TranslateNS<typeof NS>): string {
  const scaled = (next: number): string => next >= 100
    ? String(Math.round(next))
    : String(Math.round(next * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('tokens.thousand', { value: scaled(value / 1_000) })
  return t('tokens.million', { value: scaled(value / 1_000_000) })
}

/** Sum the four disjoint durable provider-usage buckets. */
function tokenTotal(
  usage: SessionProjectionMap['tokenUsage'] | undefined,
): number | undefined {
  return usage === undefined
    ? undefined
    : usage.uncachedInputTokens + usage.outputTokens
      + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** Exact whole-second active-turn duration for one agent. */
function activityDuration(
  summary: SessionSummary | undefined,
  activity: 'running' | 'inactive',
  now: number,
): number | undefined {
  if (summary === undefined) return undefined
  const timing: SessionProjectionMap['subagentTiming'] | undefined
    = summary.projectionValues?.subagentTiming
  if (timing === undefined) return undefined
  if (timing.active === undefined) return timing.settledMs
  const end = activity === 'running'
    ? now
    : timing.active.through
  return timing.settledMs + Math.max(0, end - timing.active.since)
}

/** Two-digit zero padding, so figures keep one width as they tick. */
function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Active time in at most two adjacent units, the jobs list's format. */
function formatDuration(ms: number, t: TranslateNS<typeof NS>): string {
  const total = Math.floor(Math.max(0, ms) / 1_000)
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3_600)
  if (hours > 0) return t('duration.hours', { hours: pad(hours), minutes: pad(minutes) })
  if (minutes > 0) return t('duration.minutes', { minutes: pad(minutes), seconds: pad(seconds) })
  return t('duration.seconds', { seconds: pad(seconds) })
}

/** An agent's everyday name: its delegation label, else its log title, else its id. */
function agentName(entry: ChildEntry, summaries: Summaries): string {
  return entry.label ?? summaries[entry.id]?.title ?? String(entry.id)
}

/**
 * The agents an agent started, as cards that open them. Mounting it keeps
 * that agent's catalog observed.
 */
function NestedAgents({ parentSessionId, catalogs, summaries, openChild, setCatalogOpen, t }: {
  parentSessionId: SessionId
  catalogs: Catalogs
  summaries: Summaries
  openChild: (address: SubagentAddress) => void
  setCatalogOpen: (parentSessionId: SessionId, open: boolean) => void
  t: TranslateNS<typeof NS>
}) {
  useEffect(() => {
    setCatalogOpen(parentSessionId, true)
    return () => { setCatalogOpen(parentSessionId, false) }
  }, [parentSessionId, setCatalogOpen])
  const catalog = catalogs[parentSessionId]
  const children = catalog?.entries.filter((entry): entry is ChildEntry => entry.kind === 'child') ?? []
  if (children.length === 0) return <ActivityNote>{t('loading.label')}</ActivityNote>
  return (
    <>
      {children.map(child => (
        <ActivityLink
          key={child.id}
          title={agentName(child, summaries)}
          detail={child.activity === 'running' ? t('status.running') : t('status.done')}
          onClick={() => { openChild({ parentSessionId, childSessionId: child.id, mode: child.mode }) }}
        />
      ))}
    </>
  )
}

/**
 * One agent in the list: its name and active time, opening into its facts,
 * the way into its conversation, and the agents it started.
 */
function AgentItem({
  parentSessionId, entry, current, expanded, onToggle, now, catalogs, summaries, openChild, setCatalogOpen, t,
}: {
  parentSessionId: SessionId
  entry: ChildEntry
  current: boolean
  expanded: boolean
  onToggle: () => void
  now: number
  catalogs: Catalogs
  summaries: Summaries
  openChild: (address: SubagentAddress) => void
  setCatalogOpen: (parentSessionId: SessionId, open: boolean) => void
  t: TranslateNS<typeof NS>
}) {
  const summary = summaries[entry.id]
  const name = agentName(entry, summaries)
  const running = entry.activity === 'running'
  const durationMs = activityDuration(summary, entry.activity, now)
  const duration = durationMs === undefined ? undefined : formatDuration(durationMs, t)
  const tokens = tokenTotal(summary?.projectionValues?.tokenUsage)
  const facts: ActivityFact[] = [
    { label: t('fact.status'), value: running ? t('status.running') : t('status.done') },
    ...duration !== undefined ? [{ label: t('fact.activeFor'), value: duration }] : [],
    ...tokens !== undefined ? [{ label: t('fact.tokens'), value: t('tokens.total', { value: formatTokens(tokens, t) }) }] : [],
    { label: t('fact.type'), value: entry.mode === 'one-shot' ? t('type.oneShot') : t('type.continuable') },
  ]
  return (
    <ActivityItem
      name={name}
      state={running ? 'running' : 'done'}
      status={running ? undefined : (current ? t('status.viewing') : t('status.done'))}
      meta={duration}
      open={expanded}
      onToggle={onToggle}
      toggleLabel={t(expanded ? 'row.collapse' : 'row.expand', { label: name })}
      current={current}
    >
      <ActivityDetails facts={facts}>
        {current
          ? null
          : (
            <ActivityLink
              title={t('open.conversation')}
              onClick={() => { openChild({ parentSessionId, childSessionId: entry.id, mode: entry.mode }) }}
            />
          )}
        {entry.hasChildren
          ? (
            <NestedAgents
              parentSessionId={entry.id}
              catalogs={catalogs}
              summaries={summaries}
              openChild={openChild}
              setCatalogOpen={setCatalogOpen}
              t={t}
            />
          )
          : null}
      </ActivityDetails>
    </ActivityItem>
  )
}

const NO_DESCENDANTS = { count: 0, runningCount: 0 } as const

/**
 * The header's agents menu over the direct catalog of `rootSessionId`:
 * running agents first, then the finished ones in a foldable section. The
 * catalog is observed only while the list is open.
 */
function AgentsMenu({
  rootSessionId, currentSessionId, useSessions, openChild, refresh, setCatalogOpen, t,
}: {
  rootSessionId: SessionId
  currentSessionId?: SessionId | undefined
  useSessions: SubagentHeaderLineageProps['useSessions']
  openChild: (address: SubagentAddress) => void
  refresh: (parentSessionId: SessionId) => void
  setCatalogOpen: (parentSessionId: SessionId, open: boolean) => void
  t: TranslateNS<typeof NS>
}) {
  const catalogs = useSessions(state => state.subagentsByParent)
  const summaries = useSessions(state => state.byId)
  const catalog = catalogs[rootSessionId]
  const [open, setOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<SessionId | undefined>(undefined)
  const [finishedOpen, setFinishedOpen] = useState<boolean | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())
  const setCatalogOpenRef = useRef(setCatalogOpen)
  setCatalogOpenRef.current = setCatalogOpen

  const descendants = useMemo(
    () => indexSubagentDescendants(summaries).get(rootSessionId) ?? NO_DESCENDANTS,
    [rootSessionId, summaries],
  )
  const children = catalog?.entries.filter((entry): entry is ChildEntry => entry.kind === 'child') ?? []
  const diagnostics = catalog?.entries.filter(
    (entry): entry is Extract<CatalogEntry, { kind: 'diagnostic' }> => entry.kind === 'diagnostic',
  ) ?? []
  const runningChildren = children.filter(entry => entry.activity === 'running')
  const finishedChildren = children.filter(entry => entry.activity !== 'running')
  // The catalog can arrive after the session-list baseline; never undercount
  // the already-known descendants in that window.
  const count = Math.max(children.length, descendants.count)
  const runningCount = Math.max(runningChildren.length, descendants.runningCount)
  const showFinished = finishedOpen ?? runningChildren.length === 0

  // The catalog streams membership only while someone is looking at it.
  useEffect(() => {
    if (!open) return
    setCatalogOpenRef.current(rootSessionId, true)
    return () => { setCatalogOpenRef.current(rootSessionId, false) }
  }, [open, rootSessionId])

  useEffect(() => {
    if (!open || runningCount === 0) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [open, runningCount])

  // Visibility needs evidence of agents; a bare loading catalog is not
  // evidence, so a childless session never flashes the pill.
  const visible = count > 0 || catalog?.state === 'error' || currentSessionId !== undefined
  if (!visible) return null

  const label = runningCount > 0
    ? t(runningCount === 1 ? 'agents.active.one' : 'agents.active.other', { count: runningCount })
    : t(count === 1 ? 'agents.count.one' : 'agents.count.other', { count })

  const item = (entry: ChildEntry) => (
    <AgentItem
      key={entry.id}
      parentSessionId={rootSessionId}
      entry={entry}
      current={entry.id === currentSessionId}
      expanded={expandedId === entry.id}
      onToggle={() => { setExpandedId(value => value === entry.id ? undefined : entry.id) }}
      now={now}
      catalogs={catalogs}
      summaries={summaries}
      openChild={(address) => { setOpen(false); openChild(address) }}
      setCatalogOpen={setCatalogOpen}
      t={t}
    />
  )

  return (
    <ActivityMenu
      open={open}
      onOpenChange={(next) => {
        if (next) setNow(Date.now())
        setOpen(next)
      }}
      label={label}
      busy={runningCount > 0}
      menuLabel={t('agents.list')}
    >
      {catalog === undefined || (catalog.state === 'loading' && catalog.entries.length === 0)
        ? <ActivityMessage>{t('loading.label')}</ActivityMessage>
        : null}
      {catalog?.state === 'error'
        ? (
          <ActivityMessage error action={{ label: t('retry'), onClick: () => { refresh(rootSessionId) } }}>
            {catalog.error?.message ?? t('load.error')}
          </ActivityMessage>
        )
        : null}
      {runningChildren.map(item)}
      {finishedChildren.length > 0 && runningChildren.length > 0
        ? (
          <ActivitySection
            title={t('agents.finished')}
            open={showFinished}
            onToggle={() => { setFinishedOpen(!showFinished) }}
          />
        )
        : null}
      {showFinished || runningChildren.length === 0 ? finishedChildren.map(item) : null}
      {diagnostics.map(entry => (
        <ActivityItem
          key={entry.id}
          name={String(entry.id)}
          state="error"
          status={diagnosticReason(entry, t)}
          open={false}
        />
      ))}
    </ActivityMenu>
  )
}

/**
 * The session header's agents. In an ordinary conversation: a pill listing
 * the agents it started. In an agent's own conversation: a pill back to the
 * conversation that started it, then that conversation's agents with this one
 * marked.
 * @param props - the lineage session, session standard props, and catalog actions.
 * @returns the header controls, or null when there are no agents to show.
 */
export function SubagentHeaderLineage({
  lineageSessionId, useSessions, openChild, openSession, refresh, setCatalogOpen, t,
}: SubagentHeaderLineageProps) {
  const parentId = useSessions((state) => {
    const summary = state.byId[lineageSessionId]
    return summary?.origin === 'subagent' ? summary.parentId : undefined
  })
  const parentTitle = useSessions(state => parentId === undefined ? undefined : state.byId[parentId]?.displayTitle)
  const shared = { useSessions, openChild, refresh, setCatalogOpen, t }
  if (parentId === undefined) {
    return <AgentsMenu key={lineageSessionId} rootSessionId={lineageSessionId} {...shared} />
  }
  return (
    <>
      <ActivityPill
        label={parentTitle ?? t('back.fallback')}
        onClick={() => { openSession(parentId) }}
      />
      <AgentsMenu key={lineageSessionId} rootSessionId={parentId} currentSessionId={lineageSessionId} {...shared} />
    </>
  )
}
