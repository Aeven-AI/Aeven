/** The Memory settings page: quiet cards, with detail and actions behind a reveal. */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type {
  InvariantId, ManagedInvariantChange, ManagedInvariantsPage, ManagedMemory, ManagedMemoryPage, ManagedMemoryQuery, ManagedProcedure,
  ManagedProcedureDetail, ManagedProceduresPage, MemoryDomain, MemoryItemId,
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
  procedures: () => Promise<ManagedProceduresPage>
  procedure: (id: MemoryItemId) => Promise<ManagedProcedureDetail | undefined>
  editProcedure: (id: MemoryItemId, summary: string) => Promise<ManagedProcedureDetail | undefined>
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
/** The allowance fill reads both its width and its color step from one row-local property. */
type BudgetStyle = CSSProperties & { readonly '--avn-usage-percent': string }

const PAGE_SIZE = 200

const TABS: readonly { readonly id: Tab; readonly label: MemoryLocaleKey }[] = [
  { id: 'person', label: 'tabs.person' },
  { id: 'project', label: 'tabs.project' },
  { id: 'knowledge', label: 'tabs.knowledge' },
  { id: 'capabilities', label: 'tabs.capabilities' },
  { id: 'facts', label: 'tabs.facts' },
]

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
 * Run one page operation, keeping the busy and failed state in step with its promise.
 * @param setBusy - the page's busy flag setter.
 * @param setFailed - the page's failure flag setter.
 * @returns a runner that starts the work and settles the flags.
 */
function usePendingRun(
  setBusy: (busy: boolean) => void,
  setFailed: (failed: boolean) => void,
): (work: () => Promise<void>) => void {
  return useCallback((work: () => Promise<void>) => {
    setBusy(true)
    setFailed(false)
    void work().then(() => { setBusy(false) }, () => { setBusy(false); setFailed(true) })
  }, [setBusy, setFailed])
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
          ? <Procedures {...props} reportLoading={setPaneLoading} />
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

  const run = usePendingRun(setBusy, setFailed)

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
        <CardHeading title={fact} subtitle={memory.summary.trim() === '' ? t('pending') : ago(memory.time, now, t)} open={open} />
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
                labelKey="save"
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

function Facts({ t, invariants, addInvariant, editInvariant, removeInvariant, reportLoading }: MemorySectionProps & {
  readonly reportLoading: (loading: boolean) => void
}) {
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
                              labelKey="save"
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
    <div>
      <button type="button" className={css.foldButton} aria-expanded={open} onClick={onToggle}>
        <span>{label}</span>
        <IconChevronDownOutline14 className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {open ? <div className={css.foldBody}>{children}</div> : null}
    </div>
  )
}

/** The open card's Cancel and its commit action. */
function Commit({ t, labelKey, busy, blocked = false, onCancel, onCommit }: {
  readonly t: Translate
  readonly labelKey: MemoryLocaleKey
  readonly busy: boolean
  /** The draft cannot be committed as it stands. */
  readonly blocked?: boolean
  readonly onCancel: () => void
  readonly onCommit: () => void
}) {
  return (
    <>
      <Button variant="outline" disabled={busy} onClick={onCancel}>{t('cancel')}</Button>
      <Button variant="primary" disabled={busy || blocked} onClick={onCommit}>{t(labelKey)}</Button>
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

function Procedures(props: MemorySectionProps & { readonly reportLoading: (loading: boolean) => void }) {
  const { t, procedures, reportLoading } = props
  const [state, setState] = useState<Load<ManagedProceduresPage>>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<MemoryItemId | undefined>()
  const now = Date.now()

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', value: await procedures() })
    } catch {
      // The failure is shown as the page's error state with a retry.
      setState({ status: 'error' })
    }
  }, [procedures])

  useEffect(() => { void load() }, [load])

  useEffect(() => { reportLoading(state.status === 'loading') }, [state.status, reportLoading])

  const listed = state.status === 'ready' && state.value.available ? state.value.procedures : []
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle === '' ? listed : listed.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(needle))
  }, [listed, query])

  const forget = (id: MemoryItemId) => {
    setState((current) => {
      if (current.status !== 'ready' || !current.value.available) return current
      return { status: 'ready', value: { available: true, procedures: current.value.procedures.filter(item => item.id !== id) } }
    })
  }

  if (state.status === 'loading') return <LoadingBlock label={t('loading')} />
  if (state.status === 'error') return <Failure t={t} onRetry={() => { setState({ status: 'loading' }); void load() }} />
  if (!state.value.available) return <p className={css.status}>{t('unavailable')}</p>
  if (listed.length === 0) return <p className={css.status}>{t('emptyProcedures')}</p>
  return (
    <>
      <label className={css.search}>
        <IconSearchOutline16 />
        <input
          value={query}
          placeholder={t('searchProcedures')}
          aria-label={t('searchProcedures')}
          onChange={(event) => { setQuery(event.target.value) }}
        />
      </label>
      {visible.length === 0 && <p className={css.status}>{t('emptyProcedureSearch')}</p>}
      {visible.length > 0 && (
        <ul className={css.cards}>
          {visible.map(item => (
            <ProcedureCard
              key={item.id}
              {...props}
              item={item}
              now={now}
              open={openId === item.id}
              onToggle={() => { setOpenId(openId === item.id ? undefined : item.id) }}
              onForgotten={() => { forget(item.id) }}
            />
          ))}
        </ul>
      )}
    </>
  )
}

function ProcedureCard({
  t, item, now, open, onToggle, onForgotten, procedure: loadProcedure, editProcedure, forgetMemory, openConversation, close,
}: MemorySectionProps & {
  readonly item: ManagedProcedure
  readonly now: number
  readonly open: boolean
  readonly onToggle: () => void
  readonly onForgotten: () => void
}) {
  const [steps, setSteps] = useState(false)
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [confirming, setConfirming] = useState(false)
  const [detail, setDetail] = useState<Load<ManagedProcedureDetail | undefined> | undefined>()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (open) return
    setMode('view')
    setSteps(false)
    setFailed(false)
    setGone(false)
    // A failed read is tried again the next time the card opens.
    setDetail(current => current?.status === 'error' ? undefined : current)
  }, [open])

  // Keyed on the read's inputs only: a dependency on `detail` would rerun the effect when the read starts and
  // drop its result.
  const needsDetail = open && detail === undefined
  useEffect(() => {
    if (!needsDetail) return
    setDetail({ status: 'loading' })
    loadProcedure(item.id).then(
      (value) => { setDetail({ status: 'ready', value }) },
      () => { setDetail({ status: 'error' }) },
    )
  }, [needsDetail, loadProcedure, item.id])

  const run = usePendingRun(setBusy, setFailed)

  const showConversation = () => {
    try {
      openConversation(item.sessionId)
    } catch {
      // sessions.open throws when that conversation is no longer listed.
      setGone(true)
      return
    }
    close()
  }

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
        <CardHeading title={item.name} subtitle={item.description} open={open} />
      </button>
      {open && (
        <div className={css.body}>
          <p className={css.note}>
            {t('learnedAt', { time: ago(item.time, now, t) })}
            {' · '}
            {domainLabel(item.domain, t)}
            {item.domain === 'project' && item.workspace !== undefined && ` · ${folderName(item.workspace)}`}
          </p>
          <DetailBody detail={detail} t={t}>
            {ready !== undefined && mode === 'view' && (
              <>
                <p className={css.said}>
                  <span>{t('recalled')}</span>
                  {ready.summary}
                </p>
                <Fold label={t('procedure')} open={steps} onToggle={() => { setSteps(!steps) }}>
                  <div className={css.prose}>
                    <MarkdownText text={ready.content} variant="compact" labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }} />
                  </div>
                </Fold>
              </>
            )}
            {ready !== undefined && mode === 'edit' && (
              <label className={css.field}>
                {t('recalled')}
                <textarea rows={6} value={draft} onChange={(event) => { setDraft(event.target.value) }} />
              </label>
            )}
          </DetailBody>
          {failed && !confirming && <p className={css.failure}>{t('failed')}</p>}
          {gone && <p className={css.failure}>{t('conversationGone')}</p>}
          <div className={css.footer}>
            {mode === 'view' && (
              <>
                <Button variant="outline" className={css.footerStart} onClick={showConversation}>{t('openSession')}</Button>
                <Button variant="outline" disabled={ready === undefined} onClick={() => { setDraft(ready?.summary ?? ''); setMode('edit') }}>{t('edit')}</Button>
                <Button variant="outline" onClick={() => { setFailed(false); setConfirming(true) }}>{t('forget')}</Button>
              </>
            )}
            {mode === 'edit' && (
              <Commit
                t={t}
                labelKey="save"
                busy={busy}
                blocked={draft.trim() === ''}
                onCancel={() => { setMode('view') }}
                onCommit={() => {
                  run(async () => {
                    const next = await editProcedure(item.id, draft)
                    if (next === undefined) throw new Error('procedure is gone')
                    setDetail({ status: 'ready', value: next })
                    setMode('view')
                  })
                }}
              />
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        t={t}
        open={confirming}
        title={t('forgetProcedureConfirm')}
        subject={item.name}
        action={t('forget')}
        busy={busy}
        failed={failed}
        onCancel={() => { setConfirming(false) }}
        onConfirm={() => { run(async () => { await forgetMemory(item.id); setConfirming(false); onForgotten() }) }}
      />
    </li>
  )
}

function DetailBody({ detail, t, children }: {
  readonly detail: Load<ManagedProcedureDetail | undefined> | undefined
  readonly t: Translate
  readonly children: ReactNode
}) {
  if (detail === undefined || detail.status === 'loading') return <p className={css.note}><Spinner /> {t('loading')}</p>
  if (detail.status === 'error' || detail.value === undefined) return <p className={css.failure}>{t('error')}</p>
  return children
}

function CardHeading({ title, subtitle, open }: { title: string; subtitle: string; open: boolean }): ReactNode {
  return <>
    <span className={css.headText}>
      <span className={css.title}>{title}</span>
      <span className={css.subtitle}>{subtitle}</span>
    </span>
    <IconChevronDownOutline14 className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
  </>
}
