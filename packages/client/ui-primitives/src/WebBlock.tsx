import { useState } from 'react'
import clsx from 'clsx'
import { BlockHeader } from './BlockHeader.tsx'
import { IconChevronDownOutline14, IconChevronUpOutline14 } from './icons/index.tsx'
import { MarkdownText, type MarkdownLabels } from './markdown/MarkdownText.tsx'
import css from './WebBlock.module.css'

/** Sources shown before the citation list folds, matching the edited-files card. */
const FOLDED_SOURCES = 4

/**
 * One citeable source drawn in a search card: the projection of the contract's
 * `WebSource`, with the optional fields kept optional so a provider that
 * returned only a URL still renders (its hostname becomes the label).
 */
export interface WebSourceView {
  /** The source URL; becomes a safe external link when it is http(s). */
  url: string
  /** The source title; when absent the URL's hostname labels the link. */
  title?: string | undefined
  /** A short excerpt or summary shown under the link. */
  snippet?: string | undefined
  /** Publication/crawl timestamp, a provider-supplied string shown under the link. */
  publishedAt?: string | undefined
}

/** A `web_search` card: an optional answer over a capped citation list. */
export interface WebSearchBlockProps {
  kind: 'search'
  /** Localized chrome supplied by the owning render site. */
  labels: WebBlockLabels
  /** The provider-generated answer, rendered as markdown above the sources. */
  answer?: string | undefined
  /** The cited sources, in provider order. */
  sources: WebSourceView[]
  /** True when the tool cut the source list to its result cap. */
  truncated: boolean  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}

/** A `web_fetch` card: the retrieval summary for one fetched URL. */
export interface WebFetchBlockProps {
  kind: 'fetch'
  /** Localized chrome supplied by the owning render site. */
  labels: WebBlockLabels
  /** The final URL after allowed redirects; becomes a safe external link when http(s). */
  url: string
  /** HTTP status code of the fetched response. */
  statusCode: number
  /** True when the provider or the output cap cut the fetched content. */
  truncated: boolean
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}

/** A completed web retrieval card, discriminated by `kind`. */
export type WebBlockProps = WebSearchBlockProps | WebFetchBlockProps

/** Localized chrome for {@link WebBlock}. */
export interface WebBlockLabels {
  noResults: string
  /** The fold control's collapsed-state label, e.g. "All 8 sources". */
  sourcesAll: (count: number) => string
  /** The fold control's expanded-state label. */
  sourcesCollapse: string
  http: string
  contentTruncated: string
  /** The fetch card's name in its header. */
  fetchTitle: string
  /** The search card's name in its header. */
  searchTitle: string
  /** Copy control's idle tooltip and accessible name. */
  copy: string
  /** Copy control's tooltip and accessible name during the post-copy confirmation window. */
  copied: string
  markdown: MarkdownLabels
}

/**
 * The URL to link to, or undefined when the URL must render as plain text. Only
 * http(s) becomes a navigable external anchor, so a `javascript:`/`data:`/`file:`
 * URL or an unparseable string never reaches the DOM as an href. This is the
 * http(s) subset of the allowlist MarkdownText applies to untrusted links —
 * MarkdownText also permits `mailto:`, deliberately excluded here since a
 * retrieval URL is never a mail address.
 * @param url - the source or fetch URL, from tool result content.
 * @returns the href to use, or undefined for plain text.
 */
function safeHref(url: string): string | undefined {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

/**
 * The link's visible label: the title when the provider gave one, otherwise the
 * URL's hostname, falling back to the raw URL when it does not parse OR parses
 * to an empty hostname (a `file:`/`data:`/`javascript:` URL), so a label is
 * never blank.
 * @param url - the source URL.
 * @param title - the provider title, if any.
 * @returns the label text.
 */
function linkLabel(url: string, title: string | undefined): string {
  if (title !== undefined && title !== '') return title
  try {
    const { hostname } = new URL(url)
    return hostname === '' ? url : hostname
  } catch {
    return url
  }
}

/**
 * A single URL rendered as a safe external anchor, or as plain text when the
 * URL is not an http(s) link.
 * @param props.url - the URL to render.
 * @param props.label - the visible label.
 * @param props.className - class for the anchor or the plain span.
 * @returns the anchor or span element.
 */
function SafeLink({ url, label, className }: { url: string; label: string; className?: string | undefined }) {
  const href = safeHref(url)
  if (href === undefined) return <span className={className}>{label}</span>
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  )
}

/**
 * One source row in a search card: the citation index, the safe link, and its
 * snippet and date. The index is drawn rather than left to an `<ol>` marker so
 * a folded row keeps its real 1-based citation number.
 * @param props.source - the source to render.
 * @param props.ordinal - the source's 1-based position in the full list.
 * @returns the source list item.
 */
function SourceItem({ source, ordinal }: { source: WebSourceView; ordinal: number }) {
  return (
    <li className={css.source}>
      <span className={css.index}>{ordinal}.</span>
      <span className={css.sourceBody}>
        <SafeLink url={source.url} label={linkLabel(source.url, source.title)} className={css.sourceLink} />
        {source.snippet !== undefined && source.snippet !== '' && (
          <div className={css.snippet}>{source.snippet}</div>
        )}
        {source.publishedAt !== undefined && source.publishedAt !== '' && (
          <div className={css.published}>{source.publishedAt}</div>
        )}
      </span>
    </li>
  )
}

/**
 * The search card body: the answer over the citation list, which folds after
 * four rows and expands on demand.
 * @param props - see {@link WebSearchBlockProps}.
 * @returns the search card element.
 */
function WebSearchBlock({ answer, sources, labels, className }: WebSearchBlockProps) {
  const [expanded, setExpanded] = useState(false)
  // A provider may legitimately return no answer and no sources; the chat WebRow
  // does not show the raw result content, so without this the user would see an
  // empty card. Mirror the backend's `No results found.` render text.
  const empty = (answer === undefined || answer === '') && sources.length === 0
  // The list folds only when it has rows to hide; a shorter list draws no control.
  const foldable = sources.length > FOLDED_SOURCES
  const rows = foldable && !expanded ? sources.slice(0, FOLDED_SOURCES) : sources
  // The answer, then one numbered source URL per line: what the card shows,
  // as text that pastes back into a message or a note.
  const copyText = [
    answer ?? '',
    sources.map((source, index) => `${String(index + 1)}. ${source.url}`).join('\n'),
  ].filter(part => part !== '').join('\n\n')
  return (
    <div className={clsx(css.block, className)} data-web="search">
      <BlockHeader title={labels.searchTitle} copy={{ text: copyText, label: labels.copy, copiedLabel: labels.copied }} />
      <div className={css.body}>
        {answer !== undefined && answer !== '' && (
          <div className={css.answer}><MarkdownText text={answer} labels={labels.markdown} /></div>
        )}
        {empty ? (
          <div className={css.empty}>{labels.noResults}</div>
        ) : (
          <>
            <ul className={css.sources}>
              {rows.map((source, index) => <SourceItem key={index} source={source} ordinal={index + 1} />)}
            </ul>
            {foldable && (
              <button
                type="button"
                className={css.listToggle}
                aria-expanded={expanded}
                onClick={() => { setExpanded(value => !value) }}
              >
                <span>{expanded ? labels.sourcesCollapse : labels.sourcesAll(sources.length)}</span>
                {expanded ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The fetch card body: the linked URL and its HTTP status.
 * @param props - see {@link WebFetchBlockProps}.
 * @returns the fetch card element.
 */
function WebFetchBlock({ url, statusCode, truncated, labels, className }: WebFetchBlockProps) {
  return (
    <div className={clsx(css.block, className)} data-web="fetch">
      <BlockHeader title={labels.fetchTitle} copy={{ text: url, label: labels.copy, copiedLabel: labels.copied }} />
      <div className={clsx(css.body, css.fetch)}>
        <SafeLink url={url} label={url} className={css.fetchUrl} />
        <div className={css.fetchMeta}>
          <span className={css.status}>{labels.http} {statusCode}</span>
          {truncated && <span className={css.truncated}>{labels.contentTruncated}</span>}
        </div>
      </div>
    </div>
  )
}

/**
 * Render a completed web retrieval as a structured card.
 * @param props - see {@link WebBlockProps}; `kind` selects the search or fetch body.
 * @returns the web card element.
 */
export function WebBlock(props: WebBlockProps) {
  return props.kind === 'search' ? <WebSearchBlock {...props} /> : <WebFetchBlock {...props} />
}
