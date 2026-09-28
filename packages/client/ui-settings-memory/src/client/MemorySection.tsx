/** The Memory settings page: memories grouped by what they are about, and learned capabilities. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  CapabilityStatus, ExecutionVerdict, ManagedCapability, ManagedCapabilityDetail, ManagedCapabilityEdit,
  ManagedCapabilityStatusChange, ManagedMemory, ManagedMemoryPage, ManagedMemoryQuery, MemoryItemId,
} from '@aeven/api-remotes/client'
import { Button, IconSearchOutline16, MarkdownText, Pill, SectionHeader, Spinner } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type { MemoryLocaleKey } from './locales.ts'
import css from './MemorySection.module.css'

/** Registration-side Remote operations the page calls. */
export interface MemorySectionInjected {
  memories: (request: ManagedMemoryQuery) => Promise<ManagedMemoryPage>
  editMemory: (id: MemoryItemId, summary: string) => Promise<ManagedMemory | undefined>
  forgetMemory: (id: MemoryItemId) => Promise<boolean>
  capabilities: () => Promise<ManagedCapability[]>
  capability: (name: string) => Promise<ManagedCapabilityDetail | undefined>
  editCapability: (name: string, edit: ManagedCapabilityEdit) => Promise<ManagedCapabilityDetail>
  setCapabilityStatus: (name: string, status: ManagedCapabilityStatusChange) => Promise<ManagedCapabilityDetail>
  deleteCapability: (name: string) => Promise<boolean>
}

/** Full component props assembled by the Settings slot renderer. */
export type MemorySectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.memory'>
  & InjectFace<MemorySectionInjected>

type Translate = MemorySectionProps['t']
type Tab = 'person' | 'project' | 'knowledge' | 'capabilities'

const PAGE_SIZE = 200

const TABS: readonly { readonly id: Tab; readonly label: MemoryLocaleKey }[] = [
  { id: 'person', label: 'tabPerson' },
  { id: 'project', label: 'tabProject' },
  { id: 'knowledge', label: 'tabKnowledge' },
  { id: 'capabilities', label: 'tabCapabilities' },
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

function when(time: number): string {
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function inTab(memory: ManagedMemory, tab: Tab): boolean {
  switch (tab) {
    case 'person': return memory.domain === 'person'
    case 'project': return memory.domain === 'project'
    case 'knowledge': return memory.domain === 'world' || memory.domain === 'experience'
    case 'capabilities': return false
  }
}

/**
 * Render the Memory section.
 * @param props - composed slot props and the Remote operations.
 * @returns the section element tree.
 */
export function MemorySection(props: MemorySectionProps) {
  const { t } = props
  const [tab, setTab] = useState<Tab>('person')
  return (
    <div className={css.section}>
      <SectionHeader title={t('nav')} description={t('intro')} />
      <div className={css.tabs} role="tablist">
        {TABS.map(item => (
          <Pill key={item.id} role="tab" aria-selected={tab === item.id} active={tab === item.id} onClick={() => { setTab(item.id) }}>
            {t(item.label)}
          </Pill>
        ))}
      </div>
      {tab === 'capabilities'
        ? <Capabilities {...props} />
        : <Memories {...props} tab={tab} />}
    </div>
  )
}

type Load<T> = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly value: T }

function Memories({ t, tab, memories, editMemory, forgetMemory }: MemorySectionProps & { readonly tab: Tab }) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<Load<{ available: boolean; items: ManagedMemory[]; total: number }>>({ status: 'loading' })
  const [limit, setLimit] = useState(PAGE_SIZE)

  const load = useCallback(async (signal: { cancelled: boolean }) => {
    setState({ status: 'loading' })
    try {
      const page = await memories({ ...query.trim() ? { query: query.trim() } : {}, limit, offset: 0 })
      if (signal.cancelled) return
      setState({ status: 'ready', value: page.available ? { available: true, items: [...page.memories], total: page.total } : { available: false, items: [], total: 0 } })
    } catch {
      // The failure is shown as the page's error state with a retry.
      if (!signal.cancelled) setState({ status: 'error' })
    }
  }, [memories, query, limit])

  useEffect(() => {
    const signal = { cancelled: false }
    const timer = setTimeout(() => { void load(signal) }, query ? 250 : 0)
    return () => {
      signal.cancelled = true
      clearTimeout(timer)
    }
  }, [load, query])

  const update = (id: MemoryItemId, next: ManagedMemory | undefined) => {
    setState(current => current.status !== 'ready' ? current : {
      status: 'ready',
      value: {
        ...current.value,
        items: next === undefined ? current.value.items.filter(item => item.id !== id) : current.value.items.map(item => item.id === id ? next : item),
        total: next === undefined ? current.value.total - 1 : current.value.total,
      },
    })
  }

  const visible = state.status === 'ready' ? state.value.items.filter(item => inTab(item, tab)) : []
  const groups = useMemo(() => {
    if (tab !== 'project') return [{ key: '', title: undefined, items: visible }]
    const byWorkspace = new Map<string, ManagedMemory[]>()
    for (const item of visible) byWorkspace.set(item.workspace ?? '', [...byWorkspace.get(item.workspace ?? '') ?? [], item])
    return [...byWorkspace].map(([key, items]) => ({ key, title: key || t('unknownWorkspace'), items }))
  }, [tab, visible, t])

  return (
    <div className={css.panel}>
      <label className={css.search}>
        <IconSearchOutline16 />
        <input value={query} placeholder={t('search')} aria-label={t('search')} onChange={(event) => { setQuery(event.target.value) }} />
      </label>
      {state.status === 'loading' && <p className={css.status}><Spinner /> {t('loading')}</p>}
      {state.status === 'error' && <Failure t={t} onRetry={() => { void load({ cancelled: false }) }} />}
      {state.status === 'ready' && !state.value.available && <p className={css.status}>{t('unavailable')}</p>}
      {state.status === 'ready' && state.value.available && visible.length === 0 && (
        <p className={css.status}>{query ? t('emptySearch') : t(tab === 'person' ? 'emptyPerson' : tab === 'project' ? 'emptyProject' : 'emptyKnowledge')}</p>
      )}
      {groups.filter(group => group.items.length > 0).map(group => (
        <section key={group.key} className={css.group}>
          {group.title !== undefined && <h3 className={css.groupTitle} title={group.key}>{group.title}</h3>}
          <ul className={css.list}>
            {group.items.map(item => (
              <MemoryRow key={item.id} t={t} memory={item} editMemory={editMemory} forgetMemory={forgetMemory} onChange={update} />
            ))}
          </ul>
        </section>
      ))}
      {state.status === 'ready' && state.value.items.length < state.value.total && (
        <Button variant="outline" size="sm" className={css.more} onClick={() => { setLimit(limit + PAGE_SIZE) }}>{t('loadMore')}</Button>
      )}
    </div>
  )
}

function MemoryRow({ t, memory, editMemory, forgetMemory, onChange }: {
  readonly t: Translate
  readonly memory: ManagedMemory
  readonly editMemory: MemorySectionInjected['editMemory']
  readonly forgetMemory: MemorySectionInjected['forgetMemory']
  readonly onChange: (id: MemoryItemId, next: ManagedMemory | undefined) => void
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'forget'>('view')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const text = memory.summary || memory.userText

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setFailed(false)
    try {
      await operation()
      setMode('view')
    } catch {
      // The failure is shown inline on the row.
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={css.row}>
      {mode === 'edit'
        ? <textarea className={css.editor} value={draft} rows={3} autoFocus onChange={(event) => { setDraft(event.target.value) }} />
        : <p className={css.text}>{text}{!memory.summary && <span className={css.pending}> · {t('pending')}</span>}</p>}
      <div className={css.meta}>
        <span>{when(memory.time)}</span>
        <a href={`/c/${memory.sessionId}`}>{t('openSession')}</a>
      </div>
      {failed && <p className={css.error}>{t('failed')}</p>}
      <div className={css.actions}>
        {mode === 'view' && (
          <>
            <Button size="sm" onClick={() => { setDraft(text); setMode('edit') }}>{t('edit')}</Button>
            <Button size="sm" onClick={() => { setMode('forget') }}>{t('forget')}</Button>
          </>
        )}
        {mode === 'edit' && (
          <>
            <Button size="sm" variant="primary" disabled={busy || !draft.trim()} onClick={() => { void run(async () => { onChange(memory.id, await editMemory(memory.id, draft)) }) }}>{t('save')}</Button>
            <Button size="sm" disabled={busy} onClick={() => { setMode('view') }}>{t('cancel')}</Button>
          </>
        )}
        {mode === 'forget' && (
          <>
            <span className={css.confirm}>{t('forgetConfirm')}</span>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => { void run(async () => { await forgetMemory(memory.id); onChange(memory.id, undefined) }) }}>{t('forget')}</Button>
            <Button size="sm" disabled={busy} onClick={() => { setMode('view') }}>{t('cancel')}</Button>
          </>
        )}
      </div>
    </li>
  )
}

function Failure({ t, onRetry }: { readonly t: Translate; readonly onRetry: () => void }) {
  return (
    <p className={css.failure}>
      {t('error')}
      <Button size="sm" variant="outline" onClick={onRetry}>{t('retry')}</Button>
    </p>
  )
}

function Capabilities(props: MemorySectionProps) {
  const { t, capabilities } = props
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

  if (state.status === 'loading') return <p className={css.status}><Spinner /> {t('loading')}</p>
  if (state.status === 'error') return <Failure t={t} onRetry={() => { setState({ status: 'loading' }); void load() }} />
  if (state.value.length === 0) return <p className={css.status}>{t('emptyCapabilities')}</p>
  return (
    <ul className={css.list}>
      {state.value.map(capability => (
        <li key={capability.name} className={css.row}>
          <div className={css.capabilityHead}>
            <span className={css.name}>{capability.name}</span>
            <span className={css.badge} data-status={capability.status}>{t(STATUS_LABEL[capability.status])}</span>
          </div>
          <p className={css.text}>{capability.description}</p>
          <div className={css.meta}>
            <span>{t('runs', { total: String(capability.runs.total), succeeded: String(capability.runs.succeeded), failed: String(capability.runs.failed) })}</span>
            {capability.runs.lastRunAt !== undefined && <span>{t('lastUsed', { time: when(capability.runs.lastRunAt) })}</span>}
          </div>
          {open === capability.name
            ? <CapabilityDetail {...props} name={capability.name} onClose={() => { setOpen(undefined) }} onChanged={() => { void load() }} />
            : <div className={css.actions}><Button size="sm" onClick={() => { setOpen(capability.name) }}>{t('view')}</Button></div>}
        </li>
      ))}
    </ul>
  )
}

function CapabilityDetail({ t, name, capability, editCapability, setCapabilityStatus, deleteCapability, onClose, onChanged }: MemorySectionProps & {
  readonly name: string
  readonly onClose: () => void
  readonly onChanged: () => void
}) {
  const [detail, setDetail] = useState<Load<ManagedCapabilityDetail | undefined>>({ status: 'loading' })
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view')
  const [draft, setDraft] = useState<ManagedCapabilityEdit>({ description: '', content: '' })
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const markdownLabels = useMemo(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('footnotes'),
  }), [t])

  useEffect(() => {
    let cancelled = false
    capability(name).then(
      (value) => { if (!cancelled) setDetail({ status: 'ready', value }) },
      () => { if (!cancelled) setDetail({ status: 'error' }) },
    )
    return () => { cancelled = true }
  }, [capability, name])

  const run = async (operation: () => Promise<ManagedCapabilityDetail | undefined>) => {
    setBusy(true)
    setFailed(false)
    try {
      const value = await operation()
      setDetail({ status: 'ready', value })
      setMode('view')
      onChanged()
    } catch {
      // The failure is shown inline under the capability.
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  if (detail.status === 'loading') return <p className={css.status}><Spinner /> {t('loading')}</p>
  if (detail.status === 'error') return <p className={css.error}>{t('error')}</p>
  const current = detail.value
  if (current === undefined) return null
  const retired = current.status === 'retired'
  const unconfirmed = current.status === 'candidate'

  return (
    <div className={css.detail}>
      {mode === 'edit'
        ? (
            <>
              <label className={css.field}>
                <span>{t('description')}</span>
                <input value={draft.description} onChange={(event) => { setDraft({ ...draft, description: event.target.value }) }} />
              </label>
              <label className={css.field}>
                <span>{t('procedure')}</span>
                <textarea className={css.editor} rows={14} value={draft.content} onChange={(event) => { setDraft({ ...draft, content: event.target.value }) }} />
              </label>
            </>
          )
        : (
            <>
              <div className={css.meta}>
                <span>{t('revision', { revision: String(current.revision) })}</span>
                <span>{t('learnedAt', { time: when(current.createdAt) })}</span>
              </div>
              <div className={css.procedure}><MarkdownText text={current.content} labels={markdownLabels} variant="compact" /></div>
              {current.files.length > 0 && (
                <div className={css.meta}><span>{t('files')}:</span>{current.files.map(file => <code key={file}>{file}</code>)}</div>
              )}
              <h4 className={css.subTitle}>{t('history')}</h4>
              {current.executions.length === 0
                ? <p className={css.status}>{t('noRuns')}</p>
                : (
                    <ul className={css.runs}>
                      {current.executions.slice(0, 20).map(run => (
                        <li key={run.id}>
                          <span className={css.verdict} data-verdict={run.verdict}>{t(VERDICT_LABEL[run.verdict])}</span>
                          <span>{when(run.endedAt)}</span>
                          <span>{t('revision', { revision: String(run.revision) })}</span>
                          <a href={`/c/${run.sessionId}`}>{t('openSession')}</a>
                          {(run.correction ?? run.notes) !== undefined && <span className={css.note}>{run.correction ?? run.notes}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
            </>
          )}
      {failed && <p className={css.error}>{t('failed')}</p>}
      <div className={css.actions}>
        {mode === 'view' && (
          <>
            <Button size="sm" onClick={() => { setDraft({ description: current.description, content: current.content }); setMode('edit') }}>{t('edit')}</Button>
            {unconfirmed && <Button size="sm" disabled={busy} onClick={() => { void run(() => setCapabilityStatus(name, 'learned')) }}>{t('confirmUse')}</Button>}
            {!unconfirmed && <Button size="sm" disabled={busy} onClick={() => { void run(() => setCapabilityStatus(name, retired ? 'learned' : 'retired')) }}>{t(retired ? 'restore' : 'retire')}</Button>}
            <Button size="sm" onClick={() => { setMode('delete') }}>{t('delete')}</Button>
            <Button size="sm" onClick={onClose}>{t('hide')}</Button>
          </>
        )}
        {mode === 'edit' && (
          <>
            <Button size="sm" variant="primary" disabled={busy || !draft.description.trim() || !draft.content.trim()} onClick={() => { void run(() => editCapability(name, draft)) }}>{t('save')}</Button>
            <Button size="sm" disabled={busy} onClick={() => { setMode('view') }}>{t('cancel')}</Button>
          </>
        )}
        {mode === 'delete' && (
          <>
            <span className={css.confirm}>{t('deleteConfirm')}</span>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => { void run(async () => { await deleteCapability(name); return undefined }) }}>{t('delete')}</Button>
            <Button size="sm" disabled={busy} onClick={() => { setMode('view') }}>{t('cancel')}</Button>
          </>
        )}
      </div>
    </div>
  )
}
