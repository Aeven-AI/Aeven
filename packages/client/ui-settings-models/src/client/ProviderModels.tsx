/**
 * Every model one configured API-key provider serves, with one checkbox each,
 * in the shape of the subscription cards' Models block. Chat models come from
 * the route's own catalog (installed and live-refreshed alike); image and video
 * models come from the media providers listing under the same id. A change
 * applies at once: chat models switched off land in the profile's
 * `disabledModels`, image and video models in the `media` / `media-video`
 * documents' `disabledModels`, and every model picker follows the pushed
 * invalidation.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmDiscoveredModel, SettingsNamespaceView, SettingsPathOpView } from '@aeven/api-remotes/client'
import { IconThinkOutline16, Tooltip } from '@aeven/client-ui-primitives'
import type { MediaKind, MediaModelView, ModelsOperations } from './operations.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Settings namespace whose `disabledModels` switches off listed models of one media kind. */
const MEDIA_NAMESPACE: Readonly<Record<MediaKind, string>> = { image: 'media', video: 'media-video' }

/** The model groups a card shows, in display order. */
type ModelGroup = 'chat' | MediaKind

/** Field every switch-off list is stored under. */
const DISABLED_FIELD = 'disabledModels'

/** A model list worth narrowing: below this many rows the search field is noise. */
const SEARCH_THRESHOLD = 10

/** Props of {@link ProviderModels}. */
export interface ProviderModelsProps {
  /** Provider route id; also the media provider id its image and video models carry. */
  provider: string
  /** The route's owning namespace view. */
  namespace: SettingsNamespaceView
  /** Path from the section root to this provider's profile. */
  settingsPath: readonly string[]
  /** The `media` and `media-video` views, where the deployment composes them. */
  mediaNamespaces: Partial<Record<MediaKind, SettingsNamespaceView>>
  /** Changes whenever the page reloads, so the lists are read again. */
  refreshKey: string
  /** Settings-owned synchronous schema and immutable path operations. */
  schema: SettingsSchemaOperations
  /** The Host operations this block reads and writes through. */
  operations: ModelsOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes (read-only settings provider). */
  readOnly: boolean
}

/** One row of the block. */
interface ModelRow {
  id: string
  name: string
  imageInput: boolean
  reasoning: boolean
}

/** The lists one load produced. */
interface LoadedModels {
  chat: ModelRow[]
  image: ModelRow[]
  video: ModelRow[]
}

/** A string array stored at one path, or empty. */
function storedList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/**
 * A row's label: the catalog's name, except that a name which merely repeats
 * an `org/model` id reads as its model half; the full id stays on hover.
 */
function labelOf(id: string, name: string | undefined): string {
  return name === undefined || name === id ? id.slice(id.lastIndexOf('/') + 1) : name
}

/** Order rows by the label a person scans, as the composer's model selector does. */
function byName(left: ModelRow, right: ModelRow): number {
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    || left.id.localeCompare(right.id)
}

function chatRow(model: LlmDiscoveredModel): ModelRow {
  return {
    id: model.id,
    name: labelOf(model.id, model.name),
    imageInput: model.inputModalities?.includes('image') === true,
    reasoning: model.reasoning === true,
  }
}

function mediaRow(model: MediaModelView): ModelRow {
  return { id: model.id, name: labelOf(model.id, model.label), imageInput: false, reasoning: false }
}

/** Lucide `eye`: the model reads images. */
function ImageInputIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

/** Lucide `image-plus`: the model generates images. */
function ImageOutputIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 5h6" />
      <path d="M19 2v6" />
      <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      <circle cx="9" cy="9" r="2" />
    </svg>
  )
}

/** Lucide `video`: the model generates video. */
function VideoOutputIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  )
}

function Capability({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <Tooltip label={label} side="top">
      <span className={styles['capability']} role="img" aria-label={label}>{children}</span>
    </Tooltip>
  )
}

/**
 * Render one provider's Models block.
 * @param props - the provider, its settings views, and the wire faces.
 * @returns the block.
 */
export function ProviderModels(props: ProviderModelsProps): ReactNode {
  const { provider, namespace, settingsPath, mediaNamespaces, schema, operations, t } = props
  const [loaded, setLoaded] = useState<LoadedModels | undefined>(undefined)
  const [loadFailure, setLoadFailure] = useState<string | undefined>(undefined)
  const [writeFailure, setWriteFailure] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  // A toggle shows at once; the stored lists replace it when the pushed
  // refresh lands, or the write failure restores them.
  const [pending, setPending] = useState<Partial<Record<ModelGroup, readonly string[]>>>({})

  useEffect(() => {
    let stale = false
    void Promise.all([
      operations.discoverModels(namespace.ns, { provider }),
      operations.listMediaModels('image'),
      operations.listMediaModels('video'),
    ]).then(([chat, image, video]) => {
      if (stale) return
      if (chat.kind === 'refused') {
        setLoadFailure(chat.message)
        return
      }
      setLoadFailure(undefined)
      const ofProvider = (outcome: typeof image): ModelRow[] => outcome.kind === 'found'
        ? outcome.models.filter(model => model.provider === provider).map(mediaRow).sort(byName)
        : []
      setLoaded({ chat: chat.models.map(chatRow).sort(byName), image: ofProvider(image), video: ofProvider(video) })
    })
    return () => { stale = true }
  }, [operations, namespace.ns, provider, props.refreshKey])

  // What each group stores switched off: the profile's own ids for chat, and
  // this provider's `provider/model` references for media.
  const prefix = `${provider}/`
  const stored = useMemo((): Record<ModelGroup, readonly string[]> => ({
    chat: storedList(schema.getPath(namespace.value, [...settingsPath, DISABLED_FIELD])),
    image: storedList(schema.getPath(mediaNamespaces.image?.value, [DISABLED_FIELD]))
      .filter(ref => ref.startsWith(prefix)).map(ref => ref.slice(prefix.length)),
    video: storedList(schema.getPath(mediaNamespaces.video?.value, [DISABLED_FIELD]))
      .filter(ref => ref.startsWith(prefix)).map(ref => ref.slice(prefix.length)),
  }), [schema, namespace.value, settingsPath, mediaNamespaces.image?.value, mediaNamespaces.video?.value, prefix])
  const storedKey = JSON.stringify(stored)
  useEffect(() => { setPending({}) }, [storedKey])
  const disabledOf = (group: ModelGroup): ReadonlySet<string> => new Set(pending[group] ?? stored[group])

  const write = async (group: ModelGroup, disabled: readonly string[]): Promise<void> => {
    setPending(current => ({ ...current, [group]: disabled }))
    setSaving(true)
    setWriteFailure(undefined)
    try {
      let ns: string
      let ops: SettingsPathOpView[]
      if (group === 'chat') {
        ns = namespace.ns
        const path = [...settingsPath, DISABLED_FIELD]
        ops = [disabled.length === 0 ? { op: 'unset', path } : { op: 'set', path, value: [...disabled] }]
      } else {
        ns = MEDIA_NAMESPACE[group]
        // The document holds every provider's references; only this one's change.
        const others = storedList(schema.getPath(mediaNamespaces[group]?.value, [DISABLED_FIELD]))
          .filter(ref => !ref.startsWith(prefix))
        const next = [...others, ...disabled.map(id => `${prefix}${id}`)]
        ops = [next.length === 0
          ? { op: 'unset', path: [DISABLED_FIELD] }
          : { op: 'set', path: [DISABLED_FIELD], value: next }]
      }
      const written = await operations.writeSettings(ns, ops, undefined)
      if (written.kind !== 'written') {
        setWriteFailure(written.message)
        setPending(current => ({ ...current, [group]: undefined }))
      }
    } finally {
      setSaving(false)
    }
  }

  if (loadFailure !== undefined) {
    return (
      <div className={styles['modelsBlock']}>
        <p className={styles['modelsTitle']}>{t('models')}</p>
        <p className={styles['error']} role="alert">{`${t('modelsLoadFailed')}: ${loadFailure}`}</p>
      </div>
    )
  }
  if (loaded === undefined) {
    return (
      <div className={styles['modelsBlock']}>
        <p className={styles['modelsTitle']}>{t('models')}</p>
        <p className={styles['modelsHint']} role="status">{t('modelsLoading')}</p>
      </div>
    )
  }

  const total = loaded.chat.length + loaded.image.length + loaded.video.length
  const needle = query.trim().toLowerCase()
  const matches = (row: ModelRow): boolean => needle.length === 0
    || row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle)
  const groups: { group: ModelGroup; title: keyof typeof en; rows: ModelRow[] }[] = [
    { group: 'chat' as const, title: 'modelsChat' as const, rows: loaded.chat },
    { group: 'image' as const, title: 'modelsImage' as const, rows: loaded.image },
    { group: 'video' as const, title: 'modelsVideo' as const, rows: loaded.video },
  ].filter(entry => entry.rows.length > 0)
  const locked = props.readOnly || saving
  const visibleCount = groups.reduce((count, entry) => count + entry.rows.filter(matches).length, 0)

  return (
    <div className={styles['modelsBlock']}>
      <div className={styles['modelsHead']}>
        <p className={styles['modelsTitle']}>{t('models')}</p>
        {total === 0 ? null : <span className={styles['modelsHint']}>{String(total)}</span>}
      </div>
      {total > SEARCH_THRESHOLD
        ? (
          <input
            className={`${styles['input']} ${styles['modelsSearch']}`}
            type="search"
            value={query}
            placeholder={t('modelsSearch')}
            aria-label={t('modelsSearch')}
            onChange={(event) => { setQuery(event.target.value) }}
          />
        )
        : null}
      {total === 0 ? <p className={styles['modelsHint']}>{t('modelsNone')}</p> : null}
      {total > 0 && visibleCount === 0 ? <p className={styles['modelsHint']} role="status">{t('modelsNoMatches')}</p> : null}
      {visibleCount === 0
        ? null
        : (
          <div className={`${styles['modelsScroll']} no-scrollbar`}>
            {groups.map(({ group, title, rows }) => {
              const visible = rows.filter(matches)
              if (visible.length === 0) return null
              const disabled = disabledOf(group)
              const allOn = visible.every(row => !disabled.has(row.id))
              const onCount = rows.filter(row => !disabled.has(row.id)).length
              const setVisible = (on: boolean): void => {
                const next = new Set(disabled)
                for (const row of visible) {
                  if (on) next.delete(row.id)
                  else next.add(row.id)
                }
                void write(group, [...next])
              }
              return (
                <section key={group} className={styles['modelsGroup']} aria-label={t(title)}>
                  <div className={styles['modelsGroupHead']}>
                    <span className={styles['modelsGroupTitle']}>{t(title)}</span>
                    <span className={styles['modelsHint']}>{`${String(onCount)}/${String(rows.length)}`}</span>
                    <button
                      type="button"
                      className={styles['textButton']}
                      disabled={locked}
                      onClick={() => { setVisible(!allOn) }}
                    >
                      {t(allOn ? 'deselectAll' : 'selectAll')}
                    </button>
                  </div>
                  <ul className={styles['modelsList']}>
                    {visible.map(row => (
                      <li key={row.id}>
                        <label className={styles['modelsRow']} data-locked={locked} title={row.id}>
                          <input
                            type="checkbox"
                            className={styles['modelsCheckbox']}
                            checked={!disabled.has(row.id)}
                            disabled={locked}
                            onChange={(event) => {
                              const next = new Set(disabled)
                              if (event.target.checked) next.delete(row.id)
                              else next.add(row.id)
                              void write(group, [...next])
                            }}
                          />
                          <span className={styles['modelsName']}>{row.name}</span>
                          {row.reasoning ? <Capability label={t('capabilityReasoning')}><IconThinkOutline16 /></Capability> : null}
                          {row.imageInput ? <Capability label={t('capabilityImageInput')}><ImageInputIcon /></Capability> : null}
                          {group === 'image' ? <Capability label={t('capabilityImageOutput')}><ImageOutputIcon /></Capability> : null}
                          {group === 'video' ? <Capability label={t('capabilityVideoOutput')}><VideoOutputIcon /></Capability> : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        )}
      {writeFailure === undefined ? null : <p className={styles['error']} role="alert">{writeFailure}</p>}
    </div>
  )
}
