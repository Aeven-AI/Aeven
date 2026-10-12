/**
 * The model-facing `find_images` tool: real photographs of a subject, taken
 * from the web and stored as durable image attachments.
 *
 * A question about how something actually looks is answered with the
 * photographs, not with a description of them. The images arrive as ordinary
 * image content blocks, so the client draws them in the same lane a generated
 * image uses, and the same session log carries them.
 *
 * Two sources, in this order. Wikimedia Commons first: its API returns the file
 * page and the licence with every match, and its historical photography is
 * public domain or openly licensed. Then the web seam, whose results carry the
 * page an image sits on — the route that reaches news, products, and anything
 * else Commons does not hold. A licence is cited when the source states one;
 * the page is cited either way.
 *
 * @module @aeven/tool-image-search
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ImageAttachmentRef, ImageMediaType } from '@aeven/attachment'
import { BlockAssembler, createUserMessage, HarnessError } from '@aeven/llm'
import { defineTool } from '@aeven/tools'
import type { JsonValue } from '@aeven/util-values'
import type {} from '@aeven/web'

export const name = 'tool-image-search'
export const inject = ['tools', 'attachments', 'llm']

/** Commons' API; a plain GET returns the matches with their licences. */
const API = 'https://commons.wikimedia.org/w/api.php'

/** Wikimedia asks automated callers to identify themselves. */
const USER_AGENT = 'Aeven harness (https://aeven.io) image search'

/** Milliseconds one HTTP request may take. */
const DEFAULT_TIMEOUT_MS = 20_000

/** Largest image stored by one call, in bytes. */
const DEFAULT_MAX_BYTES = 12 * 1024 * 1024

/** The most photographs one call shows. */
const MAX_COUNT = 6

/** Photographs one call shows when the model names no count. */
const DEFAULT_COUNT = 3

/** The width every Commons match is downloaded at: wide enough for a row's tiles. */
const THUMBNAIL_WIDTH = 1600

/** Pages one web search may contribute an image from. */
const WEB_PAGES = 6

/** Image types stored as they arrive; anything else is a drawing, a book scan, or a video. */
const BITMAP_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const satisfies readonly ImageMediaType[]

/** One stored image's media type. */
type BitmapType = (typeof BITMAP_TYPES)[number]

/** File extension per stored media type. */
const EXTENSIONS: Record<BitmapType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** The instruction the translating call runs under: one language, JSON back. */
const TRANSLATION_SYSTEM = 'You translate news items for a reader who reads one language. '
  + 'Reply with JSON only, no prose and no code fence: {"items":[{"title":"...","summary":"..."}]}, in the same order and count as the input. '
  + 'Translate every item into the named language, keeping names, numbers, product names and quotations intact. '
  + 'An item already in that language comes back unchanged, character for character.'

/** Words a question carries that a search for its subject does not want. */
const QUESTION_WORDS = new Set([
  'a', 'about', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'by', 'can', 'did', 'do', 'does', 'ever',
  'for', 'from', 'has', 'have', 'how', 'in', 'is', 'it', 'its', 'look', 'looked', 'me', 'of', 'on', 'or', 'photo',
  'photographs', 'photos', 'picture', 'pictures', 'please', 'show', 'still', 'that', 'the', 'their', 'them',
  'there', 'these', 'this', 'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'with',
])

/** What one call may spend. */
export interface Config {
  /** Milliseconds one HTTP request may take. */
  requestTimeoutMs?: number
  /** Largest image one call stores, in bytes. */
  maxImageBytes?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  requestTimeoutMs: z.natural().min(1_000).max(120_000).default(DEFAULT_TIMEOUT_MS),
  maxImageBytes: z.natural().min(1_024).default(DEFAULT_MAX_BYTES),
})

/** One photograph a source offers, before its bytes are stored. */
interface FoundImage {
  /** What the reply cites it as. */
  readonly title: string
  /** The page that states where the image came from. */
  readonly source: string
  /** The licence the source states, or where to read it. */
  readonly license: string
  /** The one-line summary the source gives the story, when it states one. */
  readonly summary: string
  /** The download address. */
  readonly imageUrl: string
  /** The image's media type, already restricted to {@link BITMAP_TYPES}. */
  readonly mediaType: BitmapType
}

/**
 * Whether a media type names a bitmap this tool stores.
 * @param value - the media type an external service declared.
 * @returns true when it is one of {@link BITMAP_TYPES}.
 */
function isBitmapType(value: unknown): value is BitmapType {
  return typeof value === 'string' && (BITMAP_TYPES as readonly string[]).includes(value)
}

/**
 * One JSON object, or undefined for every other value.
 * @param value - any decoded JSON value.
 * @returns the value as a record when it is one.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/**
 * The text Commons wraps one `extmetadata` field in.
 * @param value - the field's decoded value.
 * @returns the text, or undefined when the field carries none.
 */
function metadataText(value: unknown): string | undefined {
  const inner = asRecord(value)?.value
  return typeof inner === 'string' && inner.trim() !== '' ? inner.trim() : undefined
}

/**
 * The subject of a question, as a search wants it.
 *
 * A model calls this tool with the subject it was asked about, and sometimes
 * with the question itself. Dropping the question's own words is what keeps the
 * second case from searching for "did it ever exist".
 *
 * @param query - what the model asked for.
 * @returns the significant words, or the trimmed query when every word is one.
 */
function subject(query: string): string {
  const words = query.split(/\s+/).filter(word => word !== '')
  const kept = words.filter(word => !QUESTION_WORDS.has(word.toLowerCase().replace(/[^a-z0-9]/g, '')))
  return (kept.length > 0 ? kept : words).join(' ')
}

/**
 * One Commons search result as a photograph this tool can store.
 *
 * Validation here is the wire boundary: Commons is an external service, and a
 * result the schema cannot describe is skipped rather than guessed at.
 *
 * @param page - one entry of the API's `query.pages`.
 * @returns the photograph, or undefined for a result that is not a usable bitmap.
 */
function commonsImage(page: unknown): FoundImage | undefined {
  const record = asRecord(page)
  const info = Array.isArray(record?.imageinfo) ? asRecord(record.imageinfo[0]) : undefined
  const title = record?.title
  const imageUrl = info?.thumburl
  const mediaType = info?.mime
  const source = info?.descriptionurl

  if (typeof title !== 'string' || typeof imageUrl !== 'string' || !isBitmapType(mediaType)) {
    return undefined
  }

  return {
    title,
    imageUrl,
    mediaType,
    summary: metadataText(asRecord(info?.extmetadata)?.ImageDescription) ?? '',
    source: typeof source === 'string'
      ? source
      : `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
    license: metadataText(asRecord(info?.extmetadata)?.LicenseShortName) ?? 'see the file page',
  }
}

/**
 * Search Commons for photographs of a subject.
 *
 * `generator=search` returns its pages as an object keyed by page id rather
 * than as a list, which is why the values are what this reads — reading it as a
 * list is what made every search look empty.
 *
 * @param query - the subject to photograph.
 * @param limit - how many results to ask for.
 * @param signal - caller cancellation and the request deadline.
 * @returns the usable photographs, in the order Commons ranked them.
 * @throws {HarnessError} when Commons does not answer.
 */
async function searchCommons(query: string, limit: number, signal: AbortSignal): Promise<readonly FoundImage[]> {
  const url = new URL(API)
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: String(THUMBNAIL_WIDTH),
  }).toString()

  const response = await fetch(url, { signal, headers: { 'user-agent': USER_AGENT, accept: 'application/json' } })

  if (!response.ok) {
    throw new HarnessError(`Wikimedia Commons answered ${String(response.status)}`, 'IMAGE_SEARCH_HTTP')
  }

  const pages = asRecord(asRecord(await response.json())?.query)?.pages
  const found: FoundImage[] = []

  for (const page of Object.values(asRecord(pages) ?? {})) {
    const image = commonsImage(page)
    if (image !== undefined) {
      found.push(image)
    }
  }

  return found
}

/**
 * The image a page publishes as its own, which is the one a search result leads
 * with. Both spellings are read because sites disagree about which they set.
 * @param html - the page's markup.
 * @param pageUrl - the page's address, for resolving a relative image URL.
 * @returns the absolute image URL, or undefined when the page names none.
 */
function publishedImage(html: string, pageUrl: string): string | undefined {
  const meta = /<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image)["'][^>]*>/gi
  const content = /content=["']([^"']+)["']/i

  for (const tag of html.match(meta) ?? []) {
    const value = content.exec(tag)?.[1]

    if (value === undefined || value.trim() === '') {
      continue
    }

    try {
      const resolved = new URL(value, pageUrl)
      return resolved.protocol === 'https:' || resolved.protocol === 'http:' ? resolved.toString() : undefined
    } catch {
      // A malformed image URL on a page is not a reason to stop reading it.
    }
  }

  return undefined
}

/**
 * The text an HTML fragment actually reads as, with its character references
 * resolved: a card shows a sentence, not `Decart&#039;s`.
 * @param text - the fragment.
 * @returns the same text with its references decoded.
 */
function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', hellip: '\u2026', ldquo: '\u201c', lsquo: '\u2018', lt: '<',
    mdash: '\u2014', nbsp: ' ', ndash: '\u2013', quot: '"', rdquo: '\u201d', rsquo: '\u2019',
  }

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body.startsWith('#x') || body.startsWith('#X')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return named[body.toLowerCase()] ?? match
  })
}

/**
 * The headline a page announces.
 * @param html - the page's markup.
 * @returns the page's own title, or undefined when it states none.
 */
function publishedTitle(html: string): string | undefined {
  const tag = /<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]*>/i.exec(html)
  const title = tag === null ? undefined : /content=["']([^"']+)["']/i.exec(tag[0])?.[1]
  if (title !== undefined && title.trim() !== '') return title.trim()
  const document = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1]
  return document === undefined || document.trim() === '' ? undefined : document.trim()
}

/**
 * What the story itself says, from the paragraphs a reader would read first.
 *
 * A headline and a source tell the reader where a story is; this is the story —
 * the opening of the article as the page publishes it. A page's own meta
 * description is the fallback, because some publications only state that.
 *
 * @param html - the page's markup.
 * @returns the opening text, collapsed to one line, or an empty string.
 */
function articleLead(html: string): string {
  const body = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1]
    ?? /<main[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1]
    ?? html
  const stripped = body
    .replace(/<(script|style|nav|header|footer|aside|form|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')

  const paragraphs: string[] = []

  for (const match of stripped.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = decodeEntities((match[1] ?? '').replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim()

    if (text.length < 40) continue
    if (/cookie|subscribe|newsletter|sign in|advertisement|all rights reserved/i.test(text)) continue
    paragraphs.push(text)
    if (paragraphs.join(' ').length >= 320) break
  }

  const lead = decodeEntities(paragraphs.join(' ')).slice(0, 320).trim()

  if (lead !== '') {
    const end = Math.max(lead.lastIndexOf('. '), lead.lastIndexOf('? '), lead.lastIndexOf('! '))
    return end > 120 ? lead.slice(0, end + 1) : lead
  }

  const meta = /<meta[^>]+(?:property|name)=["'](?:og:description|twitter:description|description)["'][^>]*>/i.exec(html)
  const text = meta === null ? undefined : /content=["']([^"']+)["']/i.exec(meta[0])?.[1]
  return text === undefined ? '' : decodeEntities(text).replace(/\s+/g, ' ').trim().slice(0, 240)
}

/**
 * The media type an image address implies, for a host that states none.
 * @param url - the image address.
 * @returns the type to store it under.
 */
function mediaTypeOf(url: string): BitmapType {
  const path = url.toLowerCase().split('?')[0] ?? ''
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

/**
 * Photographs from the pages a web search returns.
 *
 * Each page is fetched for the image it publishes as its own; a page that
 * states no licence is still citable by its address, which is what the summary
 * says about it.
 *
 * @param web - the web seam, when the deployment mounts one.
 * @param query - the subject to photograph.
 * @param limit - how many photographs are still wanted.
 * @param signal - caller cancellation and the request deadline.
 * @returns the photographs those pages publish.
 */
async function searchWeb(web: Context['web'], query: string, limit: number, signal: AbortSignal): Promise<readonly FoundImage[]> {
  const search = await web.search({ query, maxResults: WEB_PAGES }, signal)
  const found: FoundImage[] = []

  for (const source of search.sources) {
    if (found.length === limit) {
      break
    }

    try {
      const page = await web.fetch({ url: source.url }, signal)

      if (page.body.kind !== 'html') {
        continue
      }

      const imageUrl = publishedImage(page.body.content, page.url)

      if (imageUrl === undefined) {
        continue
      }

      const headline = source.title ?? publishedTitle(page.body.content) ?? new URL(page.url).hostname
      const summary = articleLead(page.body.content)

      found.push({
        title: headline,
        summary,
        source: page.url,
        license: 'see the source page',
        imageUrl,
        mediaType: mediaTypeOf(imageUrl),
      })
    } catch {
      // A page that cannot be fetched or read contributes no image; the rest of
      // the results still answer the question.
    }
  }

  return found
}

/**
 * Download one image, refusing anything larger than the configured limit.
 * @param url - the image address.
 * @param fallbackType - the media type to store it under when the host states none.
 * @param maxBytes - the largest image this call stores.
 * @param signal - caller cancellation and the request deadline.
 * @returns the bytes and the media type to store them under.
 * @throws {HarnessError} when the host does not answer or the image is too large.
 */
async function download(url: string, fallbackType: BitmapType, maxBytes: number, signal: AbortSignal): Promise<{ data: Uint8Array; mediaType: BitmapType }> {
  const response = await fetch(url, { signal, headers: { 'user-agent': USER_AGENT } })

  if (!response.ok) {
    throw new HarnessError(`an image answered ${String(response.status)}`, 'IMAGE_SEARCH_DOWNLOAD')
  }

  const served = response.headers.get('content-type')?.split(';')[0]?.trim()
  const data = new Uint8Array(await response.arrayBuffer())

  if (data.byteLength > maxBytes) {
    throw new HarnessError(`an image exceeds ${String(maxBytes)} bytes`, 'IMAGE_SEARCH_TOO_LARGE')
  }

  return { data, mediaType: isBitmapType(served) ? served : fallbackType }
}

/**
 * The file name one stored photograph carries.
 * @param image - the photograph.
 * @param index - its position in the row, which disambiguates repeated names.
 * @returns the name the attachment store and the image viewer use.
 */
function imageName(image: FoundImage, index: number): string {
  const slug = image.title
    .replace(/^File:/, '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)

  return `${slug === '' ? `image-${String(index + 1)}` : slug}.${EXTENSIONS[image.mediaType]}`
}

/**
 * One result as the client's card view reads it: what the image is called, and
 * the page it came from. It travels as a text block beside the images, in the
 * same order, because an attachment block carries no metadata of its own.
 * @param images - the photographs that were stored, in the order shown.
 * @returns the JSON the view parses.
 */
function items(images: readonly FoundImage[]): string {
  return JSON.stringify({
    items: images.map(image => ({
      title: image.title.replace(/^File:/, ''),
      summary: image.summary,
      source: image.source,
      license: image.license,
    })),
  })
}

/**
 * The reader's own wording for the items, when the model supplied it.
 *
 * A publication's language is not always the reader's, and only the model can
 * translate what this tool extracted. Entries line up with the results by
 * position, and an entry the model left out keeps the source's own text.
 *
 * @param value - the call's `translations` argument.
 * @returns one entry per position, or an empty list when the call carried none.
 */
function readTranslations(value: unknown): readonly { title: string; summary: string }[] {
  if (!Array.isArray(value)) return []

  const entries: { title: string; summary: string }[] = []

  for (const entry of value) {
    const row = asRecord(entry)
    if (typeof row?.title !== 'string') continue
    entries.push({ title: row.title, summary: typeof row.summary === 'string' ? row.summary : '' })
  }

  return entries
}

/**
 * The model-facing text of one call, naming what the user is now looking at.
 * @param query - what was searched for.
 * @param images - the photographs that were stored, in the order shown.
 * @returns the result text.
 */
function summary(query: string, images: readonly FoundImage[]): string {
  if (images.length === 0) {
    return `No photographs of "${query}" could be found. Answer without images, and say where you looked.`
  }

  const lines = images.map((image, index) =>
    `${String(index + 1)}. ${image.title} — ${image.source} (${image.license})`)

  return [
    `Found ${String(images.length)} photograph(s) for "${query}".`,
    'They are already displayed to the user as one row of images. Do not write them again as markdown images or links.',
    'Cite each one where you use it:',
    ...lines,
  ].join('\n')
}

/**
 * The items in the reader's language, translated by this session's own model.
 *
 * A card must not read in a language the conversation is not using, and only a
 * model can translate what a page published. The call is the session's own
 * route and falls back to the source text when it fails: a card in the wrong
 * language is better than no card.
 *
 * @param ctx - context carrying the LLM service.
 * @param route - the calling session's provider and model.
 * @param language - the language the conversation uses.
 * @param images - the items to translate, in order.
 * @param signal - caller cancellation and the request deadline.
 * @returns the items, in the same order, in `language` where the call answered.
 */
async function translateItems(
  ctx: Context,
  route: { provider: string; model: string },
  language: string,
  images: readonly FoundImage[],
  signal: AbortSignal,
): Promise<readonly FoundImage[]> {
  const payload = JSON.stringify({
    language,
    items: images.map(image => ({ title: image.title, summary: image.summary })),
  })

  try {
    const assembler = new BlockAssembler()

    for await (const chunk of ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system: TRANSLATION_SYSTEM,
      messages: [createUserMessage({
        content: [{ type: 'text', text: payload }],
        source: { kind: 'plugin', plugin: 'tool-image-search' },
      })],
      maxTokens: 1_600,
      signal,
    })) assembler.push(chunk)

    const text = assembler.blocks().map(block => block.type === 'text' ? block.text : '').join('').trim()
    const parsed: unknown = JSON.parse(text.replace(/^```(?:json)?|```$/g, '').trim())
    const list = asRecord(parsed)?.items

    if (!Array.isArray(list)) return images

    return images.map((image, index) => {
      const row = asRecord(list[index])
      if (row === undefined || typeof row.title !== 'string') return image
      return {
        ...image,
        title: row.title,
        summary: typeof row.summary === 'string' && row.summary !== '' ? row.summary : image.summary,
      }
    })
  } catch {
    // A translation the model could not produce leaves the source text in place
    // rather than failing the call that found the photographs.
    return images
  }
}

/**
 * Register the `find_images` tool.
 * @param ctx - the plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const requestTimeoutMs = config.requestTimeoutMs as number
  const maxImageBytes = config.maxImageBytes as number

  ctx.tools.register(defineTool({
    name: 'find_images',
    description: 'Find real photographs of a subject — a place, building, object, artwork, product, event, or person — and show them to the user as a row of images with their sources. '
      + 'Call it whenever a question is about how something actually looks, when the user asks for photos, or when a picture carries the answer better than prose. '
      + 'It searches Wikimedia Commons and the web. Never describe a photograph you have not shown.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'What to photograph, in a few words, for example "Crystal Palace Hyde Park 1851" or "Sagrada Familia interior".',
      },
      count: {
        type: 'number',
        description: `How many photographs to show, 1 to ${String(MAX_COUNT)}. Defaults to ${String(DEFAULT_COUNT)}.`,
      },
      layout: {
        type: 'string',
        enum: ['row', 'cards'],
        description: "How the reader sees them. `row` is a row of photographs, for pictures that carry the answer. `cards` is one thumbnail with its title and source beside it, for news items and headlines. Defaults to `row`.",
      },
      language: {
        type: 'string',
        description: "The language this conversation is using, so cards read in it. Translate nothing yourself: name the language here and the tool translates the headlines and openings with the session's own model.",
      },
      translations: {
        type: 'array',
        description: 'The items in the reader\'s own language, one entry per result in the same order, for a source published in another language. Call again with the same query and these to replace what the cards read.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', required: true },
            summary: { type: 'string', required: true },
          },
        },
      },
    },
    timeoutMs: requestTimeoutMs * 4,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          items: { type: 'string', required: true },
          images: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => [
        { type: 'text' as const, text: value.text },
        { type: 'text' as const, text: value.items },
        ...value.images.map(attachment => ({ type: 'image' as const, attachment: attachment as unknown as ImageAttachmentRef })),
      ],
    },
    async execute(args, exec) {
      const raw = (args as { query?: unknown }).query
      const query = typeof raw === 'string' ? raw.trim() : ''

      if (query === '') {
        throw new HarnessError('find_images needs what to photograph', 'IMAGE_SEARCH_QUERY')
      }

      const asked = (args as { count?: unknown }).count
      const wanted = typeof asked === 'number' && Number.isFinite(asked) ? Math.trunc(asked) : DEFAULT_COUNT
      const count = Math.min(Math.max(wanted, 1), MAX_COUNT)
      const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(requestTimeoutMs)])
      const cards = (args as { layout?: unknown }).layout === 'cards'
      const translations = readTranslations((args as { translations?: unknown }).translations)
      const web = ctx.get('web')
      const candidates: FoundImage[] = []

      // A card is a headline: it comes from the pages a search returns, because
      // a file name from an archive is not a headline and its subject is often
      // not the story. Everything else asks Commons first for the photographed
      // record, then the web for what an archive does not hold.
      if (cards && web !== undefined) {
        candidates.push(...await searchWeb(web, query, count, signal))
      } else {
        try {
          candidates.push(...await searchCommons(subject(query), count * 2, signal))
        } catch {
          // A Commons outage is not a failed call: the web source may still answer.
        }

        if (candidates.length < count && web !== undefined) {
          try {
            candidates.push(...await searchWeb(web, query, count - candidates.length, signal))
          } catch {
            // Same reasoning: the photographs already found are still worth showing.
          }
        }
      }

      const stored: ImageAttachmentRef[] = []
      const used: FoundImage[] = []

      for (const image of candidates) {
        if (used.length === count) {
          break
        }

        // A translated call replaces what the cards read; the bytes are the same
        // files, which the attachment store already holds by content.
        const translation = translations[used.length]
        const described: FoundImage = translation === undefined
          ? image
          : { ...image, title: translation.title, summary: translation.summary === '' ? image.summary : translation.summary }

        try {
          const fetched = await download(image.imageUrl, image.mediaType, maxImageBytes, signal)
          stored.push(await ctx.attachments.saveImage({
            data: fetched.data,
            mediaType: fetched.mediaType,
            name: imageName(described, used.length),
          }))
          used.push(described)
        } catch {
          // One file that cannot be fetched or stored is left out of the row;
          // the remaining photographs still answer the question.
        }
      }

      // A card never reads in a language the conversation is not using: the
      // session's own model translates the source text when a language was
      // named and the model did not supply the wording itself.
      const language = typeof (args as { language?: unknown }).language === 'string'
        ? ((args as { language: string }).language).trim()
        : ''
      const provider = exec.agent?.options.provider
      const model = exec.agent?.options.model
      const described = language !== '' && translations.length === 0 && provider !== undefined && model !== undefined
        ? await translateItems(ctx, { provider, model }, language, used, signal)
        : used

      // The schema describes the attachments as plain objects, which is what a
      // tool result carries; `render` reads them back as attachment references.
      return { text: summary(query, described), items: items(described), images: stored as unknown as Record<string, JsonValue>[] }
    },
  }))
}
