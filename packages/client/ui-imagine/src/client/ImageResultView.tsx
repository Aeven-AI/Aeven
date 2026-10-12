/**
 * The photographs a search tool found, drawn at their own call.
 *
 * The call is indexed in the image lane, so it stays visible outside the folded
 * process group. Two shapes, chosen by the call itself: a row of photographs,
 * and — for news — one headline card per result, a square thumbnail with the
 * headline and its source beside it.
 *
 * @module
 */
import type { ToolCallViewProps } from '@aeven/client-ui-tool/client'
import type { MessageImageSource } from '@aeven/client-ui-conversation/client'
import css from './ImageToolView.module.css'

/** One result as the tool reported it, beside its image. */
interface ResultItem {
  readonly title: string
  readonly summary: string
  readonly source: string
  readonly license: string
}

/**
 * The items one settled call reported, in the order its images follow.
 * @param block - the settled call.
 * @returns the parsed items, or an empty list when the call carries none.
 */
function itemsOf(block: ToolCallViewProps['block']): readonly ResultItem[] {
  if (!('kind' in block)) return []

  for (const content of block.content) {
    if (content.type !== 'text') continue
    try {
      const parsed: unknown = JSON.parse(content.text)
      const list = (parsed as { items?: unknown }).items
      if (!Array.isArray(list)) continue
      const items: ResultItem[] = []
      for (const entry of list) {
        const row = entry as { title?: unknown; summary?: unknown; source?: unknown; license?: unknown }
        if (typeof row.title !== 'string' || typeof row.source !== 'string') continue
        items.push({
          title: row.title,
          summary: typeof row.summary === 'string' ? row.summary : '',
          source: row.source,
          license: typeof row.license === 'string' ? row.license : '',
        })
      }
      return items
    } catch {
      // A text block that is not the item list is the summary; keep looking.
    }
  }

  return []
}

/**
 * The layout the call asked for.
 * @param block - the call, settled or running.
 * @returns the layout, defaulting to a row of photographs.
 */
function layoutOf(block: ToolCallViewProps['block']): 'row' | 'cards' {
  const raw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? ''
  return raw.includes('"cards"') ? 'cards' : 'row'
}

/**
 * What one result looks like: a headline card, or a photograph in a row.
 * @param props - the call and the owner's image renderer.
 * @returns the images, in the shape the call asked for.
 */
export function ImageResultView({ block, renderImages }: ToolCallViewProps) {
  if (!('kind' in block) || block.isError || renderImages === undefined) return null

  const images: MessageImageSource[] = []

  for (const content of block.content) {
    if (content.type === 'image') images.push({ attachment: content.attachment })
  }

  if (images.length === 0) return null

  if (layoutOf(block) === 'cards') {
    const items = itemsOf(block)
    return (
      <div className={css.cards} data-found-images={images.length}>
        {images.map((image, index) => {
          const item = items[index]
          let host = item?.source ?? ''
          try { host = new URL(item?.source ?? '').hostname.replace(/^www\./, '') } catch {
            // A source that is not a URL stays as the tool reported it.
          }
          return (
            <article className={css.card} key={index} data-found-card={index}>
              <div className={css.cardThumb}>
                {renderImages({ images: [image], align: 'start', layout: 'fill' })}
              </div>
              <a className={css.cardBody} href={item?.source ?? '#'} target="_blank" rel="noreferrer">
                <span className={css.cardTitle}>{item?.title ?? ''}</span>
                {item?.summary !== undefined && item.summary !== '' && <span className={css.cardSummary}>{item.summary}</span>}
                <span className={css.cardSource}>{host}</span>
              </a>
            </article>
          )
        })}
      </div>
    )
  }

  return (
    <div className={css.root} data-found-images={images.length}>
      <div className={css.frames} data-frames={images.length}>
        {images.map((image, index) => (
          <div className={css.frame} key={index} data-found-image-frame={index}>
            {renderImages({ images: [image], align: 'start', layout: 'fill' })}
          </div>
        ))}
      </div>
    </div>
  )
}
