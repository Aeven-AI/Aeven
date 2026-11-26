/**
 * The Artifacts start page, shown in place of a blank chat's Hero while the address is `/artifacts`: kind pills
 * over a grid of cards, one per finished file Æven created, grouped by date. The cards are the Inspiration
 * page's: 4:5, the preview filling the card, the title over a dark fade, four to a row and fewer as the page
 * narrows. The list arrives a page of conversations at a time, so the first cards show while older
 * conversations are still being read.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { ContentLoader, Spinner, useNarrowerThan } from '@aeven/client-ui-primitives'
import type {} from '@aeven/client-ui-conversation/client'
import type { Artifact, ArtifactCursor, ArtifactKind, ArtifactListValue } from '@aeven/host-artifacts/types'
import { groupByDate, type ArtifactGroup } from './groups.ts'
import { MotionPreview } from './MotionPreview.tsx'
import { TextPreview, isTextArtifact } from './TextPreview.tsx'
import { usePictureTurn } from './slots.ts'
import type {} from './locales.ts'
import css from './ArtifactsPage.module.css'

/** Content widths under which the grid drops to three cards and then two; the Inspiration page's own. */
const THREE_CARDS_BELOW_PX = 721
const TWO_CARDS_BELOW_PX = 449

/** The kind pills, in order. A Motion film is a video to its reader, so the Videos pill shows both. */
const KINDS = ['document', 'slides', 'pdf', 'page', 'image', 'video'] as const satisfies readonly ArtifactKind[]

/** One kind pill. */
type KindFilter = typeof KINDS[number]

/**
 * Whether an artifact has nothing to show on this device: its file is gone and no stored copy was kept. Such an
 * artifact stays out of the grid and makes no request; the Missing pill lists it.
 * @param artifact - the artifact.
 * @returns true when nothing of it can be shown here.
 */
function unavailable(artifact: Artifact): boolean {
  return artifact.missing === true && artifact.attachmentId === undefined
}

/** The pill an artifact is shown under. */
function pillOf(kind: ArtifactKind): KindFilter {
  return kind === 'motion' ? 'video' : kind
}

/** What the page receives from the plugin. */
export interface ArtifactsPageInjected {
  /**
   * Read one page of artifacts.
   * @param cursor - the previous page's cursor; absent starts at the newest conversation.
   * @returns the page, or `null` when the Host could not be reached.
   */
  list: (cursor?: ArtifactCursor) => Promise<ArtifactListValue | null>
  /**
   * Open an artifact in place: its conversation, with the file in the right sidebar.
   * @param artifact - the artifact to open.
   */
  open: (artifact: Artifact) => void
  /**
   * The address that opens an artifact on its own, so a card opens in a new tab like any link.
   * @param artifact - the artifact.
   * @returns the conversation's address naming the file.
   */
  hrefOf: (artifact: Artifact) => string
  /**
   * URLs a card may draw an image or video artifact from, in the order to try them.
   * @param artifact - the artifact to preview.
   * @returns the candidate URLs; empty for a kind with no picture of its own.
   */
  previewUrls: (artifact: Artifact) => readonly string[]
  /**
   * Fetch a Motion film's document for its card's player.
   * @param artifact - a `motion` artifact.
   * @param signal - aborts the fetch when the card leaves the page.
   * @returns the film's HTML, or undefined when no source serves it.
   */
  loadMotion: (artifact: Artifact, signal: AbortSignal) => Promise<string | undefined>
  /**
   * Fetch the opening of a text or Markdown file for its card.
   * @param artifact - a text artifact.
   * @param signal - aborts the fetch when the card leaves the page.
   * @returns the opening, or undefined when the file cannot be read.
   */
  loadText: (artifact: Artifact, signal: AbortSignal) => Promise<string | undefined>
  /**
   * The last complete list the page read, kept while the app stays open: a return to the page shows it at once
   * and replaces it when the fresh read completes, so the cards never empty out and load again.
   */
  lastList: { read: () => readonly Artifact[] | undefined; keep: (items: readonly Artifact[]) => void }
}

type Translate = PropsLocale<'artifacts'>['t']

/** How far the list has loaded. */
interface Loaded {
  readonly items: readonly Artifact[]
  readonly scanned: number
  readonly total: number
  readonly done: boolean
}


/**
 * Render the Artifacts page.
 * @param props - the injected list, open and preview operations, and the translator.
 * @returns the pills, the grouped grid, and the loading, empty or failed state.
 */
export function ArtifactsPage({ list, open, hrefOf, previewUrls, loadMotion, loadText, lastList, t }:
  PropsRuntime<'conversation.start'> & ArtifactsPageInjected & PropsLocale<'artifacts'>) {
  const [loaded, setLoaded] = useState<Loaded>(() => {
    const kept = lastList.read()
    return kept === undefined ? { items: [], scanned: 0, total: 0, done: false } : { items: kept, scanned: 0, total: 0, done: true }
  })
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [kind, setKind] = useState<KindFilter | 'all' | 'missing'>('all')
  const root = useRef<HTMLElement>(null)
  const three = useNarrowerThan(root, THREE_CARDS_BELOW_PX)
  const two = useNarrowerThan(root, TWO_CARDS_BELOW_PX)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    // With a list already on screen, the fresh read runs behind it and replaces it once complete.
    const refreshing = lastList.read() !== undefined
    if (!refreshing) setLoaded({ items: [], scanned: 0, total: 0, done: false })
    void (async () => {
      let cursor: ArtifactCursor | undefined
      const items: Artifact[] = []
      for (;;) {
        const page = await list(cursor)
        if (cancelled) return
        if (page === null) {
          if (!refreshing) setFailed(true)
          return
        }
        items.push(...page.items)
        const done = page.nextCursor === null
        if (done) lastList.keep([...items])
        if (!refreshing || done) setLoaded({ items: [...items], scanned: page.scanned, total: page.total, done })
        if (done) return
        cursor = page.nextCursor
      }
    })()
    return () => { cancelled = true }
  }, [list, lastList, attempt])

  const missingCount = useMemo(() => loaded.items.filter(unavailable).length, [loaded.items])
  const shown = useMemo(() => {
    if (kind === 'missing') return loaded.items.filter(unavailable)
    const present = loaded.items.filter(item => !unavailable(item))
    return kind === 'all' ? present : present.filter(item => pillOf(item.kind) === kind)
  }, [loaded.items, kind])
  const groups = useMemo(() => groupByDate(shown, Date.now()), [shown])
  const monthName = useMemo(() => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }), [])
  const groupTitle = useCallback(
    (group: ArtifactGroup): string =>
      (group.fixed !== undefined ? t(`group.${group.fixed}`) : monthName.format(group.monthOf)),
    [t, monthName],
  )

  return (
    <section ref={root} className={css.root} data-cards={two ? '2' : three ? '3' : undefined} aria-label={t('title')}>
      <ContentLoader active={!failed && !loaded.done && loaded.total === 0} label={t('loading')} />
      <div className={css.content}>
        <nav className={css.tabs} aria-label={t('filters.label')}>
          <button type="button" className={css.tab} aria-pressed={kind === 'all'} onClick={() => { setKind('all') }}>
            {t('filter.all')}
          </button>
          {KINDS.map(id => (
            <button key={id} type="button" className={css.tab} aria-pressed={kind === id} onClick={() => { setKind(id) }}>
              {t(`filter.${id}`)}
            </button>
          ))}
          {missingCount > 0 && (
            <button type="button" className={css.tab} aria-pressed={kind === 'missing'} onClick={() => { setKind('missing') }}>
              {t('filter.missing', { count: missingCount })}
            </button>
          )}
        </nav>
        {failed && (
          <div className={css.state}>
            <p>{t('failed')}</p>
            <button type="button" className={css.retry} onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</button>
          </div>
        )}
        {groups.map(group => (
          <section key={group.key} className={css.group} aria-label={groupTitle(group)}>
            <h2 className={css.groupTitle}>{groupTitle(group)}</h2>
            <div className={css.grid}>
              {group.items.map(artifact => (
                <ArtifactCard
                  key={artifact.id}
                  artifact={artifact}
                  away={unavailable(artifact)}
                  t={t}
                  urls={previewUrls(artifact)}
                  loadMotion={loadMotion}
                  loadText={loadText}
                  href={hrefOf(artifact)}
                  onOpen={() => { open(artifact) }}
                />
              ))}
            </div>
          </section>
        ))}
        {!failed && !loaded.done && loaded.total > 0 && (
          <p className={css.progress} role="status">{t('scanning', { scanned: loaded.scanned, total: loaded.total })}</p>
        )}
        {!failed && loaded.done && shown.length === 0 && (
          <div className={css.state}><p>{t(loaded.items.length === 0 ? 'empty' : 'emptyFilter')}</p></div>
        )}
      </div>
    </section>
  )
}

/**
 * One artifact card. An image or video draws itself, trying each candidate URL in turn, and a video plays
 * silently while hovered. A Motion film shows its first frame and plays the same way. Any other kind, and a
 * picture none of whose sources load, is a paper card with the kind and the name in ink.
 * The card is a link: a plain click opens the artifact in place, and a modified or middle click, or the
 * browser's own link menu, opens its address in a new tab.
 * @param props - the artifact, its candidate preview URLs, the film loader, its address, the translator and the open handler.
 * @returns the card link.
 */
function ArtifactCard({ artifact, away, urls, loadMotion, loadText, href, t, onOpen }: {
  artifact: Artifact
  /** Nothing of the artifact is on this device: the card is paper and loads nothing. */
  away: boolean
  urls: readonly string[]
  loadMotion: ArtifactsPageInjected['loadMotion']
  loadText: ArtifactsPageInjected['loadText']
  href: string
  t: Translate
  onOpen: () => void
}) {
  const [attempt, setAttempt] = useState(0)
  const [ready, setReady] = useState(false)
  const [motionFailed, setMotionFailed] = useState(false)
  const [textState, setTextState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const text = !away && isTextArtifact(artifact)
  const textReady = useCallback(() => { setTextState('ready') }, [])
  const textFailed = useCallback(() => { setTextState('failed') }, [])
  const [hovered, setHovered] = useState(false)
  const motion = !away && artifact.kind === 'motion' && !motionFailed
  const url = away ? undefined : urls[attempt]
  const next = useCallback(() => { setAttempt(value => value + 1) }, [])
  const show = useCallback(() => { setReady(true) }, [])
  const failMotion = useCallback(() => { setMotionFailed(true) }, [])
  // A cached image can finish before React attaches its listener, so the element's own state is read on mount.
  const imageRef = useCallback((element: HTMLImageElement | null) => {
    if (element !== null && element.complete && element.naturalWidth > 0) setReady(true)
  }, [])
  const card = useRef<HTMLAnchorElement>(null)
  const picture = !motion && !text && artifact.kind !== 'video' && url !== undefined
  const turn = usePictureTurn(card, picture)
  // A picture whose sources all failed, and one that loaded, give their turn back.
  const { done } = turn
  useEffect(() => { if (url === undefined || ready) done() }, [url, ready, done])
  const pictured = motion || url !== undefined
  // Text sets itself on paper: the spinner holds until its opening arrives, and the caption stays in ink.
  const state = text ? (textState === 'loading' ? 'loading' : 'paper') : !pictured ? 'paper' : ready ? 'ready' : 'loading'
  return (
    <a
      ref={card} href={href} className={css.card} data-kind={artifact.kind} data-state={state}
      aria-label={t('open', { name: artifact.title })} title={artifact.title === artifact.name ? artifact.name : `${artifact.title} \u00b7 ${artifact.name}`}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        onOpen()
      }}
      onMouseEnter={() => { setHovered(true) }} onMouseLeave={() => { setHovered(false) }}
      onFocus={() => { setHovered(true) }} onBlur={() => { setHovered(false) }}
    >
      {text && textState !== 'failed' && <TextPreview artifact={artifact} load={loadText} onReady={textReady} onFail={textFailed} />}
      {motion && <MotionPreview artifact={artifact} load={loadMotion} playing={hovered && ready} onReady={show} onFail={failMotion} />}
      {!motion && url !== undefined && (artifact.kind === 'video'
        ? (
          <video
            key={url} className={css.image} src={url} preload="metadata" muted loop playsInline aria-hidden="true"
            onLoadedData={show} onError={next}
            onMouseEnter={(event) => { void event.currentTarget.play().catch(() => {}) }}
            onMouseLeave={(event) => { event.currentTarget.pause() }}
          />
        )
        : turn.granted && <img key={url} ref={imageRef} className={css.image} src={url} alt="" onLoad={show} onError={next} />)}
      {pictured && !text && <span className={css.shade} aria-hidden="true" />}
      <span className={css.caption}>
        <span className={css.title}>{artifact.title}</span>
        <span className={css.kind}>{away ? t('missingNote') : t(`kind.${artifact.kind}`)}</span>
      </span>
      {/* Kept mounted while anything loads into the card, so it fades out as the content arrives, as on Inspiration. */}
      {(pictured || text) && <span className={css.preloader} aria-hidden="true"><Spinner /></span>}
    </a>
  )
}
