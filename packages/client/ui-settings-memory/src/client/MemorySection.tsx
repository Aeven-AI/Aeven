/** The Memory settings page: quiet cards, with detail and actions behind a reveal. */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type {
  CapabilityRunMetrics, CapabilityStatus, ExecutionVerdict, InvariantId, ManagedCapability, ManagedCapabilityDetail, ManagedCapabilityEdit,
  ManagedCapabilityStatusChange, ManagedInvariantChange, ManagedInvariantsPage, ManagedMemory, ManagedMemoryPage, ManagedMemoryQuery,
  MemoryDomain, MemoryItemId,
} from '@aeven/api-remotes/client'
import { Button, IconChevronDownOutline14, IconSearchOutline16, LoadingBlock, MarkdownText, Modal, SectionHeader, Spinner, relativeTime } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type { MemoryLocaleKey } from './locales.ts'
import css from './MemorySection.module.css'

/** Registration-side operations the page calls. */
export interface MemorySectionInjected {
  memories: (request: ManagedMemoryQuery) => Promise<ManagedMemoryPage>
  editMemory: (id: MemoryItemId, summary: string) => Promise<ManagedMemory | undefined>
  forgetMemory: (id: MemoryItemId) => Promise<boolean>
  invariants: () => Promise<ManagedInvariantsPage>
  addInvariant: (text: string) => Promise<ManagedInvariantChange>
  editInvariant: (id: InvariantId, text: string) => Promise<ManagedInvariantChange>
  removeInvariant: (id: InvariantId) => Promise<ManagedInvariantChange>
  capabilities: () => Promise<ManagedCapability[]>
  capability: (name: string) => Promise<ManagedCapabilityDetail | undefined>
  editCapability: (name: string, edit: ManagedCapabilityEdit) => Promise<ManagedCapabilityDetail>
  setCapabilityStatus: (name: string, status: ManagedCapabilityStatusChange) => Promise<ManagedCapabilityDetail>
  deleteCapability: (name: string) => Promise<boolean>
  /**
   * Switch the app to a conversation and leave Settings.
   * @param sessionId - conversation to show.
   */
  openConversation: (sessionId: string) => void
}

/** Full component props assembled by the slot renderer. */
export type MemorySectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.memory'>
  & InjectFace<MemorySectionInjected>

type Translate = MemorySectionProps['t']
type MemoriesTab = 'person' | 'project' | 'knowledge'
type Tab = MemoriesTab | 'facts' | 'capabilities'
type Load<T> = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly value: T }
type Fold = 'procedure' | 'runs' | 'origin'
/** The allowance fill reads both its width and its color step from one row-local property. */
type BudgetStyle = CSSProperties & { readonly '--avn-usage-percent': string }

const PAGE_SIZE = 200

const TABS: readonly { readonly id: Tab; readonly label: MemoryLocaleKey }[] = [
  { id: 'person', label: 'tabs.person' },
  { id: 'project', label: 'tabs.project' },
  { id: 'knowledge', label: 'tabs.knowledge' },
  { id: 'facts', label: 'tabs.facts' },
  { id: 'capabilities', label: 'tabs.capabilities' },
]

const STATUS_LABEL = {
  'candidate': 'statusCandidate',
  'learned': 'statusLearned',
  'trusted': 'statusTrusted',
  'needs-validation': 'statusNeedsValidation',
  'degraded': 'statusDegraded',
  'retired': 'statusRetired',
} satisfies Record<CapabilityStatus, MemoryLocaleKey>

const VERDICT_LABEL = {
  verified: 'verdictVerified',
  succeeded: 'verdictSucceeded',
  failed: 'verdictFailed',
  unknown: 'verdictUnknown',
} satisfies Record<ExecutionVerdict, MemoryLocaleKey>

/** The domains each memory tab lists; the provider filters, so paging and totals count only the tab's own memories. */
const TAB_DOMAINS: Record<MemoriesTab, readonly MemoryDomain[]> = {
  person: ['person'],
  project: ['project'],
  knowledge: ['world', 'experience'],
}

const EMPTY: Record<MemoriesTab, MemoryLocaleKey> = {
  person: 'emptyPerson',
  project: 'emptyProject',
  knowledge: 'emptyKnowledge',
}

/**
 * Render the Memory section.
 * @param props - composed slot props and the Remote operations.
 * @returns the section element tree.
 */
export function MemorySection(props: MemorySectionProps) {
  const { t } = props
  const tabsId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [tab, setTab] = useState<Tab>('person')
  // The active pane reports its own read: while the first one is in flight the
  // section shows its header and the loading mark alone, so neither the strip
  // nor a pane's own controls sit above an empty page.
  const [paneLoading, setPaneLoading] = useState(true)
  const select = (next: Tab): void => {
    setPaneLoading(true)
    setTab(next)
  }
  return (
    <div className={css.section}>
      <SectionHeader title={t('nav')} description={t('intro')} />
      {!paneLoading && <div className={css.tabs} role="tablist" aria-label={t('tabs')}>
        {TABS.map((item, index) => {
          const selected = tab === item.id
          return (
            <button
              key={item.id}
              ref={(element) => { tabRefs.current[index] = element }}
              id={`${tabsId}-tab-${item.id}`}
              type="button"
              role="tab"
              className={css.tab}
              aria-selected={selected}
              aria-controls={`${tabsId}-panel-${item.id}`}
              data-active={selected ? 'true' : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => { select(item.id) }}
              onKeyDown={(event) => {
                let nextIndex: number
                switch (event.key) {
                  case 'ArrowRight': nextIndex = (index + 1) % TABS.length; break
                  case 'ArrowLeft': nextIndex = (index - 1 + TABS.length) % TABS.length; break
                  case 'Home': nextIndex = 0; break
                  case 'End': nextIndex = TABS.length - 1; break
                  default: return
                }
                event.preventDefault()
                const next = TABS[nextIndex]
                const button = tabRefs.current[nextIndex]
                if (next === undefined || button === null || button === undefined) return
                select(next.id)
                button.focus()
              }}
            >
              {t(item.label)}
            </button>
          )
        })}
      </div>}
      <div
        id={`${tabsId}-panel-${tab}`}
        className={css.panel}
        role={paneLoading ? undefined : 'tabpanel'}
        aria-labelledby={paneLoading ? undefined : `${tabsId}-tab-${tab}`}
      >
        {tab === 'capabilities'
          ? <Capabilities {...props} reportLoading={setPaneLoading} />
          : tab === 'facts'
            ? <Facts {...props} reportLoading={setPaneLoading} />
            : <Memories {...props} tab={tab} reportLoading={setPaneLoading} />}
      </div>
    </div>
  )
}

function formatWhen(time: number): string {
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function ago(time: number, now: number, t: Translate): string {
  const { unit, n } = relativeTime(time, now)
  switch (unit) {
    case 'now': return t('timeNow')
    case 'minutes': return t('timeMinutes', { n: String(n) })
    case 'hours': return t('timeHours', { n: String(n) })
    case 'days': return t('timeDays', { n: String(n) })
    case 'months': return t('timeMonths', { n: String(n) })
    case 'years': return t('timeYears', { n: String(n) })
  }
}

function domainLabel(domain: MemoryDomain, t: Translate): string {
  switch (domain) {
    case 'person': return t('tabs.person')
    case 'project': return t('tabs.project')
    case 'world': return t('domainWorld')
    case 'experience': return t('domainExperience')
  }
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(part => part.length > 0)
  return parts[parts.length - 1] ?? path
}

function duration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  return seconds < 90
    ? new Intl.NumberFormat(undefined, { style: 'unit', unit: 'second', unitDisplay: 'narrow' }).format(seconds)
    : new Intl.NumberFormat(undefined, { style: 'unit', unit: 'minute', unitDisplay: 'narrow', maximumFractionDigits: 1 }).format(seconds / 60)
}

function metrics(t: Translate, value: CapabilityRunMetrics): string {
  const steps = String(value.toolCalls)
  const time = duration(value.durationMs)
  if (value.tokens === undefined) return t('metrics', { steps, time })
  const tokens = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value.tokens.input + value.tokens.output)
  return t('metricsTokens', { steps, time, tokens })
}

/** What a promote, replace, or remove attempt means for the user. An unknown reason is a failure, not a guess. */
function standingMessage(change: ManagedInvariantChange, t: Translate): string {
  if (!change.available) return t('factsUnavailable')
  if (change.changed) return t('promoted')
  switch (change.reason) {
    case 'too-long': return t('reasonTooLong', { limit: String(change.view.maxEntryChars) })
    case 'full': return t('reasonFull', { chars: String(change.view.chars), max: String(change.view.maxChars) })
    case 'empty': return t('reasonEmpty')
    case 'missing': return t('reasonMissing')
    default: return t('failed')
  }
}

/** A loaded list: the fetched records, the provider's match count, and the offset the next page starts at. */
interface MemoryList {
  readonly available: boolean
  readonly items: readonly ManagedMemory[]
  readonly total: number
  readonly next: number
  /** Whether the provider may hold records past `next`: it reported more matches and the last page was not empty. */
  readonly more: boolean
}

/** An empty page means the provider has nothing past `next`, whatever its count says. */
function hasMore(pageLength: number, next: number, total: number): boolean {
  return pageLength > 0 && next < total
}

function Memories({
  t, tab, close, memories, editMemory, forgetMemory, openConversation, addInvariant, reportLoading,
}: MemorySectionProps & { readonly tab: MemoriesTab; readonly reportLoading: (loading: boolean) => void }) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<Load<MemoryList>>({ status: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  const [openId, setOpenId] = useState<MemoryItemId | undefined>()
  const generation = useRef(0)
  const now = Date.now()

  useEffect(() => { reportLoading(state.status === 'loading') }, [state.status, reportLoading])

  const fetchPage = useCallback(async (offset: number): Promise<ManagedMemoryPage> => {
    const text = query.trim()
    return memories({ ...text ? { query: text } : {}, domains: TAB_DOMAINS[tab], limit: PAGE_SIZE, offset })
  }, [memories, query, tab])

  const load = useCallback(async () => {
    const current = ++generation.current
    setState({ status: 'loading' })
    setLoadingMore(false)
    setMoreFailed(false)
    try {
      const page = await fetchPage(0)
      if (current !== generation.current) return
      setState({
        status: 'ready',
        value: page.available
          ? {
            available: true,
            items: page.memories,
            total: page.total,
            next: page.memories.length,
            more: hasMore(page.memories.length, page.memories.length, page.total),
          }
          : { available: false, items: [], total: 0, next: 0, more: false },
      })
    } catch {
      // The failure is shown as the page's error state with a retry.
      if (current === generation.current) setState({ status: 'error' })
    }
  }, [fetchPage])

  const loadMore = (list: MemoryList) => {
    const current = generation.current
    setLoadingMore(true)
    setMoreFailed(false)
    void fetchPage(list.next).then((page) => {
      if (current !== generation.current) return
      setLoadingMore(false)
      setState((previous) => {
        if (previous.status !== 'ready') return previous
        if (!page.available) return { status: 'ready', value: { ...previous.value, more: false } }
        const seen = new Set(previous.value.items.map(memory => memory.id))
        const items = [...previous.value.items, ...page.memories.filter(memory => !seen.has(memory.id))]
        const next = previous.value.next + page.memories.length
        return { status: 'ready', value: { ...previous.value, items, total: page.total, next, more: hasMore(page.memories.length, next, page.total) } }
      })
    }, () => {
      // The failure is shown beside the load-more button, which retries.
      if (current !== generation.current) return
      setLoadingMore(false)
      setMoreFailed(true)
    })
  }

  useEffect(() => {
    const timer = setTimeout(() => { void load() }, query ? 250 : 0)
    return () => {
      generation.current++
      clearTimeout(timer)
    }
  }, [load, query])

  useEffect(() => { setOpenId(undefined) }, [tab])

  const visible = state.status === 'ready' ? state.value.items : []
  const grouped = useMemo(() => groupProjects(visible, tab, t), [visible, tab, t])

  const update = (id: MemoryItemId, next: ManagedMemory | undefined) => {
    setState((current) => {
      if (current.status !== 'ready') return current
      if (next !== undefined) {
        return { status: 'ready', value: { ...current.value, items: current.value.items.map(memory => memory.id === id ? next : memory) } }
      }
      // A forgotten record shifts every later record one place toward the start of the provider's list.
      const items = current.value.items.filter(memory => memory.id !== id)
      const total = Math.max(0, current.value.total - 1)
      const nextOffset = Math.max(0, current.value.next - 1)
      return { status: 'ready', value: { ...current.value, items, total, next: nextOffset, more: current.value.more && nextOffset < total } }
    })
  }

  return (
    <>
      {state.status !== 'loading' && <label className={css.search}>
        <IconSearchOutline16 />
        <input
          value={query}
          placeholder={t('search')}
          aria-label={t('search')}
          onChange={(event) => { setQuery(event.target.value) }}
        />
      </label>}
      {state.status === 'loading' && <LoadingBlock label={t('loading')} />}
      {state.status === 'error' && <Failure t={t} onRetry={() => { void load() }} />}
      {state.status === 'ready' && !state.value.available && <p className={css.status}>{t('unavailable')}</p>}
      {state.status === 'ready' && state.value.available && visible.length === 0 && (
        <p className={css.status}>{t(query.trim() ? 'emptySearch' : EMPTY[tab])}</p>
      )}
      {state.status === 'ready' && state.value.available && visible.length > 0 && grouped.map(group => (
        <section key={group.key} className={css.group}>
          {group.label !== '' && <h3 className={css.groupLabel} title={group.title}>{group.label}</h3>}
          <ul className={css.cards}>
            {group.items.map(memory => (
              <MemoryCard
                key={memory.id}
                t={t}
                memory={memory}
                now={now}
                open={openId === memory.id}
                onToggle={() => { setOpenId(openId === memory.id ? undefined : memory.id) }}
                editMemory={editMemory}
                forgetMemory={forgetMemory}
                addInvariant={addInvariant}
                openConversation={openConversation}
                close={close}
                onChange={update}
              />
            ))}
          </ul>
        </section>
      ))}
      {state.status === 'ready' && state.value.more && (
        <div className={css.more}>
          {moreFailed && <span className={css.failure}>{t('failed')}</span>}
          <Button variant="outline" disabled={loadingMore} onClick={() => { loadMore(state.value) }}>
            {loadingMore ? <><Spinner /> {t('loading')}</> : t('loadMore')}
          </Button>
        </div>
      )}
    </>
  )
}

function groupProjects(
  items: readonly ManagedMemory[],
  tab: MemoriesTab,
  t: Translate,
): { key: string; label: string; title: string; items: ManagedMemory[] }[] {
  if (tab !== 'project') return [{ key: 'all', label: '', title: '', items: [...items] }]
  const map = new Map<string, ManagedMemory[]>()
  for (const memory of items) {
    const key = memory.workspace ?? ''
    const list = map.get(key)
    if (list !== undefined) list.push(memory)
    else map.set(key, [memory])
  }
  return [...map.entries()].map(([key, group]) => ({
    key: key === '' ? 'unknown' : key,
    label: key === '' ? t('unknownWorkspace') : folderName(key),
    title: key,
    items: group,
  }))
}

function MemoryCard({ t, memory, now, open, onToggle, editMemory, forgetMemory, addInvariant, openConversation, close, onChange }: {
  readonly t: Translate
  readonly memory: ManagedMemory
  readonly now: number
  readonly open: boolean
  readonly onToggle: () => void
  readonly editMemory: MemorySectionInjected['editMemory']
  readonly forgetMemory: MemorySectionInjected['forgetMemory']
  readonly addInvariant: MemorySectionInjected['addInvariant']
  readonly openConversation: MemorySectionInjected['openConversation']
  readonly close: () => void
  readonly onChange: (id: MemoryItemId, next: ManagedMemory | undefined) => void
}) {
  const fact = memory.summary || memory.userText
  const said = memory.summary.trim() !== '' && memory.userText.trim() !== memory.summary.trim() ? memory.userText : undefined
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [confirming, setConfirming] = useState(false)
  const [draft, setDraft] = useState(fact)
  const [details, setDetails] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [gone, setGone] = useState(false)
  const [standing, setStanding] = useState<ManagedInvariantChange | undefined>()

  useEffect(() => {
    if (open) return
    setMode('view')
    setDetails(false)
    setFailed(false)
    setGone(false)
    setStanding(undefined)
    setDraft(fact)
  }, [open, fact])

  const run = (work: () => Promise<void>) => {
    setBusy(true)
    setFailed(false)
    void work().then(() => { setBusy(false) }, () => { setBusy(false); setFailed(true) })
  }

  const showConversation = () => {
    try {
      openConversation(memory.sessionId)
    } catch {
      // sessions.open throws when that conversation is no longer listed.
      setGone(true)
      return
    }
    close()
  }

  return (
    <li className={open ? `${css.card} ${css.cardOpen}` : css.card}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${fact}`}
        onClick={onToggle}
      >
        <span className={css.headText}>
          <span className={css.title}>{fact}</span>
          <span className={css.subtitle}>{memory.summary.trim() === '' ? t('pending') : ago(memory.time, now, t)}</span>
        </span>
        <IconChevronDownOutline14 className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {open && (
        <div className={css.body}>
          {mode === 'view' && said !== undefined && (
            <p className={css.said}>
              <span>{t('youSaid')}</span>
              {said}
            </p>
          )}
          {mode === 'view' && (
            <Fold label={t('details')} open={details} onToggle={() => { setDetails(!details) }}>
              <dl className={css.facts}>
                <div className={css.fact}>
                  <dt>{t('kind')}</dt>
                  <dd>{domainLabel(memory.domain, t)}</dd>
                </div>
                <div className={css.fact}>
                  <dt>{t('when')}</dt>
                  <dd>{formatWhen(memory.time)}</dd>
                </div>
                {memory.workspace !== undefined && (
                  <div className={css.fact}>
                    <dt>{t('workspace')}</dt>
                    <dd>{memory.workspace}</dd>
                  </div>
                )}
              </dl>
            </Fold>
          )}
          {mode === 'edit' && (
            <label className={css.field}>
              {t('edit')}
              <textarea rows={4} value={draft} onChange={(event) => { setDraft(event.target.value) }} />
            </label>
          )}
          {failed && !confirming && <p className={css.failure}>{t('failed')}</p>}
          {gone && <p className={css.failure}>{t('conversationGone')}</p>}
          {standing !== undefined && (
            <p className={standing.available && standing.changed ? css.note : css.failure}>{standingMessage(standing, t)}</p>
          )}
          <div className={css.footer}>
            {mode === 'view' && (
              <>
                <Button variant="outline" className={css.footerStart} onClick={showConversation}>{t('openSession')}</Button>
                <Button
                  variant="outline"
                  disabled={busy || fact.trim() === ''}
                  onClick={() => { setStanding(undefined); run(async () => { setStanding(await addInvariant(fact)) }) }}
                >
                  {t('rememberAlways')}
                </Button>
                <Button variant="outline" onClick={() => { setDraft(fact); setMode('edit') }}>{t('edit')}</Button>
                <Button variant="outline" onClick={() => { setFailed(false); setConfirming(true) }}>{t('forget')}</Button>
              </>
            )}
            {mode === 'edit' && (
              <Commit
                t={t}
                label="save"
                busy={busy}
                blocked={draft.trim() === ''}
                onCancel={() => { setMode('view') }}
                onCommit={() => { run(async () => { onChange(memory.id, await editMemory(memory.id, draft)); setMode('view') }) }}
              />
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        t={t}
        open={confirming}
        title={t('forgetConfirm')}
        subject={fact}
        action={t('forget')}
        busy={busy}
        failed={failed}
        onCancel={() => { setConfirming(false) }}
        onConfirm={() => { run(async () => { await forgetMemory(memory.id); setConfirming(false); onChange(memory.id, undefined) }) }}
      />
    </li>
  )
}

function Facts({ t, invariants, addInvariant, editInvariant, removeInvariant, reportLoading }: MemorySectionProps & { readonly reportLoading: (loading: boolean) => void }) {
  const composerId = useId()
  const [state, setState] = useState<Load<ManagedInvariantsPage>>({ status: 'loading' })
  const [draft, setDraft] = useState('')
  /** The one statement being edited or confirmed for removal. */
  const [active, setActive] = useState<
    { readonly id: InvariantId; readonly mode: 'edit'; readonly text: string } | { readonly id: InvariantId; readonly mode: 'remove' } | undefined
  >()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [outcome, setOutcome] = useState<ManagedInvariantChange | undefined>()
  const now = Date.now()

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', value: await invariants() })
    } catch {
      // The failure is shown as the page's error state with a retry.
      setState({ status: 'error' })
    }
  }, [invariants])

  useEffect(() => { void load() }, [load])

  useEffect(() => { reportLoading(state.status === 'loading') }, [state.status, reportLoading])

  // A refused statement leaves the list standing and reports why, so the user decides what to drop instead of
  // finding a statement silently absent from what every request carries.
  const run = (work: () => Promise<ManagedInvariantChange>, then?: () => void) => {
    setBusy(true)
    setFailed(false)
    void work().then((change) => {
      setBusy(false)
      setOutcome(change)
      if (change.available && change.changed) {
        setState({ status: 'ready', value: { available: true, ...change.view } })
        then?.()
      }
    }, () => { setBusy(false); setFailed(true) })
  }

  if (state.status === 'loading') return <LoadingBlock label={t('loading')} />
  if (state.status === 'error') return <Failure t={t} onRetry={() => { setState({ status: 'loading' }); void load() }} />
  const view = state.value
  if (!view.available) return <p className={css.status}>{t('factsUnavailable')}</p>
  const used = `${String(view.maxChars === 0 ? 0 : Math.min(100, Math.round((view.chars / view.maxChars) * 100)))}%`

  return (
    <>
      <p className={css.factsLead}>{t('factsIntro')}</p>
      <div className={css.budget}>
        <div className={css.budgetTrack}>
          <div className={css.budgetFill} style={{ '--avn-usage-percent': used, width: used } as BudgetStyle} />
        </div>
        <div className={css.budgetText}>
          <span>{t('factsBudget', { chars: String(view.chars), max: String(view.maxChars) })}</span>
          <span>{t('factsMaxChars', { limit: String(view.maxEntryChars) })}</span>
        </div>
      </div>
      {view.entries.length === 0
        ? <p className={css.factsEmpty}>{t('factsEmpty')}</p>
        : (
          <ul className={css.cards}>
            {view.entries.map((entry) => {
              const row = active?.id === entry.id ? active : undefined
              return (
                <li key={entry.id} className={css.factRow}>
                  {row?.mode === 'edit'
                    ? (
                      <>
                        <textarea
                          className={css.composerArea}
                          rows={3}
                          aria-label={t('edit')}
                          value={row.text}
                          onChange={(event) => { setActive({ id: entry.id, mode: 'edit', text: event.target.value }) }}
                        />
                        <div className={css.factMeta}>
                          <span className={css.composerHint}>{`${String(row.text.trim().length)} / ${String(view.maxEntryChars)}`}</span>
                          <span className={css.factActions}>
                            <Commit
                              t={t}
                              label="save"
                              busy={busy}
                              blocked={row.text.trim() === ''}
                              onCancel={() => { setActive(undefined) }}
                              onCommit={() => { run(() => editInvariant(entry.id, row.text), () => { setActive(undefined) }) }}
                            />
                          </span>
                        </div>
                      </>
                    )
                    : (
                      <>
                        <p className={css.factText}>{entry.text}</p>
                        <div className={css.factMeta}>
                          <span>{t('confirmed', { time: ago(entry.confirmedAt, now, t) })}</span>
                          <span className={css.factActions}>
                            <Button variant="outline" size="sm" onClick={() => { setActive({ id: entry.id, mode: 'edit', text: entry.text }) }}>
                              {t('edit')}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => { setFailed(false); setActive({ id: entry.id, mode: 'remove' }) }}>
                              {t('remove')}
                            </Button>
                          </span>
                        </div>
                      </>
                    )}
                </li>
              )
            })}
          </ul>
        )}
      <div className={css.composer}>
        <label className={css.composerLabel} htmlFor={composerId}>{t('factsAdd')}</label>
        <textarea
          id={composerId}
          className={css.composerArea}
          rows={2}
          value={draft}
          placeholder={t('factsPlaceholder')}
          onChange={(event) => { setDraft(event.target.value) }}
        />
        <div className={css.composerFooter}>
          <span className={css.composerHint}>{draft.trim() === '' ? '' : `${String(draft.trim().length)} / ${String(view.maxEntryChars)}`}</span>
          <Button
            variant="primary"
            disabled={busy || draft.trim() === ''}
            onClick={() => { run(() => addInvariant(draft), () => { setDraft('') }) }}
          >
            {t('factsSubmit')}
          </Button>
        </div>
      </div>
      {failed && active?.mode !== 'remove' && <p className={css.failure}>{t('failed')}</p>}
      {outcome !== undefined && (
        <p className={outcome.available && outcome.changed ? css.note : css.failure}>{standingMessage(outcome, t)}</p>
      )}
      <ConfirmDialog
        t={t}
        open={active?.mode === 'remove'}
        title={t('removeConfirm')}
        subject={view.entries.find(entry => entry.id === active?.id)?.text ?? ''}
        action={t('remove')}
        busy={busy}
        failed={failed}
        onCancel={() => { setActive(undefined) }}
        onConfirm={() => {
          if (active === undefined) return
          run(() => removeInvariant(active.id), () => { setActive(undefined) })
        }}
      />
    </>
  )
}

function Fold({ label, open, onToggle, children }: {
  readonly label: string
  readonly open: boolean
  readonly onToggle: () => void
  readonly children: ReactNode
}) {
  return (
    <div className={css.fold}>
      <button type="button" className={css.foldButton} aria-expanded={open} onClick={onToggle}>
        <span>{label}</span>
        <IconChevronDownOutline14 className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {open ? <div className={css.foldBody}>{children}</div> : null}
    </div>
  )
}

/** The open card's Cancel and its commit action. */
function Commit({ t, label, busy, blocked = false, onCancel, onCommit }: {
  readonly t: Translate
  readonly label: MemoryLocaleKey
  readonly busy: boolean
  /** The draft cannot be committed as it stands. */
  readonly blocked?: boolean
  readonly onCancel: () => void
  readonly onCommit: () => void
}) {
  return (
    <>
      <Button variant="outline" disabled={busy} onClick={onCancel}>{t('cancel')}</Button>
      <Button variant="primary" disabled={busy || blocked} onClick={onCommit}>{t(label)}</Button>
    </>
  )
}

/**
 * The confirmation every removal asks for: a dialog naming what goes, answered by Cancel or the filled
 * removal button. A failed removal keeps the dialog open with its error.
 */
function ConfirmDialog({ t, open, title, subject, action, busy, failed, onCancel, onConfirm }: {
  readonly t: Translate
  readonly open: boolean
  readonly title: string
  /** What the removal applies to, quoted in the dialog. */
  readonly subject: string
  readonly action: string
  readonly busy: boolean
  readonly failed: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onCancel() }}
      title={title}
      closeLabel={t('cancel')}
      className={css.dialog as string}
      footer={(
        <>
          <Button variant="outline" autoFocus disabled={busy} onClick={onCancel}>{t('cancel')}</Button>
          <Button variant="primary" className={css.dangerFill} disabled={busy} onClick={onConfirm}>{action}</Button>
        </>
      )}
    >
      {subject.trim() === '' ? null : <p className={css.dialogSubject}>{subject}</p>}
      {failed ? <p className={css.failure}>{t('failed')}</p> : null}
    </Modal>
  )
}

function Failure({ t, onRetry }: { readonly t: Translate; readonly onRetry: () => void }) {
  return (
    <p className={css.failure}>
      {t('error')}
      <button type="button" className={css.textButton} onClick={onRetry}>{t('retry')}</button>
    </p>
  )
}

function Capabilities(props: MemorySectionProps & { readonly reportLoading: (loading: boolean) => void }) {
  const { t, capabilities, reportLoading } = props
  const [state, setState] = useState<Load<ManagedCapability[]>>({ status: 'loading' })
  const [open, setOpen] = useState<string | undefined>()

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', value: await capabilities() })
    } catch {
      // The failure is shown as the page's error state with a retry.
      setState({ status: 'error' })
    }
  }, [capabilities])

  useEffect(() => { void load() }, [load])

  useEffect(() => { reportLoading(state.status === 'loading') }, [state.status, reportLoading])

  if (state.status === 'loading') return <LoadingBlock label={t('loading')} />
  if (state.status === 'error') return <Failure t={t} onRetry={() => { setState({ status: 'loading' }); void load() }} />
  if (state.value.length === 0) return <p className={css.status}>{t('emptyCapabilities')}</p>
  return (
    <ul className={css.cards}>
      {state.value.map(capability => (
        <CapabilityCard
          key={capability.name}
          {...props}
          item={capability}
          open={open === capability.name}
          onToggle={() => { setOpen(open === capability.name ? undefined : capability.name) }}
          onChanged={() => { void load() }}
        />
      ))}
    </ul>
  )
}

function CapabilityCard({
  t, item, open, onToggle, capability: loadCapability, editCapability, setCapabilityStatus, deleteCapability,
  openConversation, close, onChanged,
}: MemorySectionProps & {
  readonly item: ManagedCapability
  readonly open: boolean
  readonly onToggle: () => void
  readonly onChanged: () => void
}) {
  const [fold, setFold] = useState<Fold | undefined>()
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [confirming, setConfirming] = useState(false)
  const [detail, setDetail] = useState<Load<ManagedCapabilityDetail | undefined> | undefined>()
  const [draft, setDraft] = useState({ description: item.description, content: '' })
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [gone, setGone] = useState(false)
  const retired = item.status === 'retired'
  const origin = item.origin
  const needsDetail = open && (mode === 'edit' || fold === 'procedure' || fold === 'runs')

  useEffect(() => {
    if (!open) {
      setMode('view')
      setFold(undefined)
      setFailed(false)
      setGone(false)
    }
  }, [open])

  useEffect(() => {
    if (!needsDetail || detail !== undefined) return
    let cancelled = false
    setDetail({ status: 'loading' })
    loadCapability(item.name).then(
      (value) => { if (!cancelled) setDetail({ status: 'ready', value }) },
      () => { if (!cancelled) setDetail({ status: 'error' }) },
    )
    return () => { cancelled = true }
  }, [needsDetail, detail, loadCapability, item.name])

  useEffect(() => {
    if (detail?.status !== 'ready' || detail.value === undefined) return
    setDraft({ description: detail.value.description, content: detail.value.content })
  }, [detail])

  const run = (work: () => Promise<ManagedCapabilityDetail | undefined>) => {
    setBusy(true)
    setFailed(false)
    void work().then((next) => {
      setBusy(false)
      if (next === undefined) onChanged()
      else {
        setDetail({ status: 'ready', value: next })
        setMode('view')
        onChanged()
      }
    }, () => { setBusy(false); setFailed(true) })
  }

  const showConversation = (sessionId: string) => {
    try {
      openConversation(sessionId)
    } catch {
      // sessions.open throws when that conversation is no longer listed.
      setGone(true)
      return
    }
    close()
  }

  const toggle = (next: Fold) => { setFold(fold === next ? undefined : next) }
  const ready = detail?.status === 'ready' ? detail.value : undefined

  return (
    <li className={open ? `${css.card} ${css.cardOpen}` : css.card}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${item.name}`}
        onClick={onToggle}
      >
        <span className={css.headText}>
          <span className={css.title}>{item.name}</span>
          <span className={css.subtitle}>{item.description}</span>
        </span>
        <IconChevronDownOutline14 className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {open && (
        <div className={css.body}>
          {mode === 'view' && (
            <>
              <p className={css.note}>
                {t(STATUS_LABEL[item.status])}
                {' · '}
                {t('revision', { revision: String(item.revision) })}
                {item.runs.lastRunAt !== undefined && ` · ${t('lastUsed', { time: formatWhen(item.runs.lastRunAt) })}`}
              </p>
              {item.impact !== undefined && (
                <p className={css.note}>
                  {t('impactBefore', { metrics: metrics(t, item.impact.before) })}
                  {' · '}
                  {item.impact.after === undefined
                    ? t('impactPending')
                    : t('impactNow', { metrics: metrics(t, item.impact.after), runs: String(item.impact.runs) })}
                </p>
              )}
              <Fold label={t('procedure')} open={fold === 'procedure'} onToggle={() => { toggle('procedure') }}>
                <DetailBody detail={detail} t={t}>
                  {ready !== undefined && (
                    <>
                      <div className={css.prose}>
                        <MarkdownText text={ready.content} variant="compact" labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }} />
                      </div>
                      {ready.files.length > 0 && (
                        <p className={css.note}>{t('files')}: {ready.files.join(', ')}</p>
                      )}
                    </>
                  )}
                </DetailBody>
              </Fold>
              <Fold label={t('history')} open={fold === 'runs'} onToggle={() => { toggle('runs') }}>
                <DetailBody detail={detail} t={t}>
                  {ready !== undefined && ready.executions.length === 0 && <p className={css.note}>{t('noRuns')}</p>}
                  {ready !== undefined && ready.executions.length > 0 && (
                    <ul className={css.runs}>
                      {ready.executions.map(run => (
                        <li key={run.id} className={css.run}>
                          <span>{t(VERDICT_LABEL[run.verdict])} · {formatWhen(run.endedAt)}</span>
                          <button type="button" className={css.textButton} onClick={() => { showConversation(run.sessionId) }}>{t('openSession')}</button>
                          {(run.correction ?? run.notes) !== undefined && (
                            <span className={css.subtitle}>{run.correction ?? run.notes}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </DetailBody>
              </Fold>
              {origin !== undefined && (
                <Fold label={t('origin')} open={fold === 'origin'} onToggle={() => { toggle('origin') }}>
                  <p className={css.said}>{origin.request}</p>
                  {origin.tools.length > 0 && (
                    <p className={css.note}>{t('tools')}: {origin.tools.join(', ')}</p>
                  )}
                  <button type="button" className={css.textButton} onClick={() => { showConversation(origin.sessionId) }}>{t('openSession')}</button>
                </Fold>
              )}
            </>
          )}
          {mode === 'edit' && (
            <DetailBody detail={detail} t={t}>
              {ready !== undefined && (
                <>
                  <label className={css.field}>
                    {t('description')}
                    <input value={draft.description} onChange={(event) => { setDraft({ ...draft, description: event.target.value }) }} />
                  </label>
                  <label className={css.field}>
                    {t('procedure')}
                    <textarea
                      rows={8}
                      value={draft.content}
                      onChange={(event) => { setDraft({ ...draft, content: event.target.value }) }}
                    />
                  </label>
                </>
              )}
            </DetailBody>
          )}
          {failed && !confirming && <p className={css.failure}>{t('failed')}</p>}
          {gone && <p className={css.failure}>{t('conversationGone')}</p>}
          <div className={css.footer}>
            {mode === 'view' && (
              <>
                <Button variant="outline" onClick={() => { setMode('edit') }}>{t('edit')}</Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => { run(() => setCapabilityStatus(item.name, retired ? 'learned' : 'retired')) }}
                >
                  {t(retired ? 'restore' : 'retire')}
                </Button>
                <Button variant="outline" onClick={() => { setFailed(false); setConfirming(true) }}>{t('delete')}</Button>
              </>
            )}
            {mode === 'edit' && (
              <Commit
                t={t}
                label="save"
                busy={busy}
                blocked={draft.description.trim() === '' || draft.content.trim() === ''}
                onCancel={() => { setMode('view') }}
                onCommit={() => { run(() => editCapability(item.name, draft)) }}
              />
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        t={t}
        open={confirming}
        title={t('deleteConfirm')}
        subject={item.name}
        action={t('delete')}
        busy={busy}
        failed={failed}
        onCancel={() => { setConfirming(false) }}
        onConfirm={() => { run(async () => { await deleteCapability(item.name); setConfirming(false); return undefined }) }}
      />
    </li>
  )
}

function DetailBody({ detail, t, children }: {
  readonly detail: Load<ManagedCapabilityDetail | undefined> | undefined
  readonly t: Translate
  readonly children: ReactNode
}) {
  if (detail === undefined || detail.status === 'loading') return <p className={css.note}><Spinner /> {t('loading')}</p>
  if (detail.status === 'error' || detail.value === undefined) return <p className={css.failure}>{t('error')}</p>
  return children
}
