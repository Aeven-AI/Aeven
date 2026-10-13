/** Cold-safe Session list and search projection. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@aeven/agent-presets'
import type {} from '@aeven/document-extract'
import type { ImageAttachmentLimits } from '@aeven/attachment'
import { SessionLogOffset } from '@aeven/session'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@aeven/session'
import type { ProjectionSnapshot } from '@aeven/session-projection'
import type {} from '@aeven/session-projection-cache'
import type {} from '@aeven/session-persistence'
import { SessionQueryError, type SessionSearchCursor } from '@aeven/session-query'
import { RemoteError } from '@aeven/typert-protocol'
import type {} from '@aeven/identity-user'
import { callerMayAccessSession } from './agent.ts'
import { z } from 'zod'
import {
  SESSION_SEARCH_RESULT_LIMIT,
  SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS,
} from './types.ts'
import type {
  FileIntake, SessionListMetadata, SessionProjectionHints, SessionProjectionValues, SessionSearchItem,
  SessionSearchValue, SessionSummary,
} from './types.ts'

/**
 * One cold Session awaiting its list summary, with the exact inherited cut when
 * its source can supply one.
 *
 * The cut is not decoration: a seeded (fork) Session's durable projection-cache
 * row is keyed by it, and a {@link SessionHeader} cannot express it, so without
 * the cut the row is addressed under the unseeded identity and silently
 * discarded — which is how fork children lost their titles in the navigation.
 */
interface ColdListEntry {
  header: SessionHeader
  inheritedEventCount?: SessionLogOffset
}

/**
 * Cold sessions whose title one listing will refold from its log. The cap
 * bounds the exceptional path: a home whose cache is wholly unreadable (an
 * older build facing a newer domain version) repairs a slice of its sessions
 * per listing and writes each row back, instead of reading every log at once.
 */
const COLD_TITLE_REFOLD_LIMIT = 20

const SEARCH_PROVIDER_CALL_LIMIT = 100
const SESSION_SEARCH_QUERY_MAX_CHARS = 500
const MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])

const sessionListMetadataSchema: z.ZodType<SessionListMetadata> = z.object({
  blank: z.boolean(),
  lastPromptAt: z.number().nullable(),
})

const imageLimitsSchema = z.object({
  maxImageBytes: z.number().int().positive(),
  maxImagesPerMessage: z.number().int().positive(),
  maxMessageImageBytes: z.number().int().positive(),
  maxImagePixels: z.number().int().positive(),
  maxImageDimension: z.number().int().positive(),
  mediaTypes: z.array(z.string()),
}) as unknown as z.ZodType<ImageAttachmentLimits>

const fileIntakeSchema = z.object({
  maxFileBytes: z.number().int().positive(),
  maxFilesPerMessage: z.number().int().positive(),
  maxMessageFileBytes: z.number().int().positive(),
  extensions: z.array(z.string()),
  mediaTypes: z.array(z.string()),
}) as unknown as z.ZodType<FileIntake>

/**
 * Advance the Session-list metadata projection by one committed event.
 * @param state - metadata before the event.
 * @param event - next committed Session event.
 * @returns the original or advanced metadata value.
 */
export function applySessionListMetadata(
  state: SessionListMetadata,
  event: SessionEvent,
): SessionListMetadata {
  const blank = state.blank && event.type !== 'turn/start'
  const lastPromptAt = event.type === 'user/message' && event.data.source.kind === 'user'
    ? event.time
    : state.lastPromptAt
  return blank === state.blank && lastPromptAt === state.lastPromptAt
    ? state
    : { blank, lastPromptAt }
}

/**
 * Return the longest prefix containing at most `maximum` Unicode code points.
 * @param value - source text.
 * @param maximum - maximum number of Unicode code points.
 * @returns the source text or its longest allowed prefix.
 */
export function truncateUnicodeCodePoints(value: string, maximum: number): string {
  let count = 0
  let end = 0
  for (const codePoint of value) {
    if (count === maximum) return value.slice(0, end)
    count++
    end += codePoint.length
  }
  return value
}

/** Owns list projection registration, cache-only cold summaries, and authorized search. */
export class ApiSessionList {
  /** @param ctx - Host context carrying Session, query, persistence, and projection services. */
  constructor(private readonly ctx: Context) {
    ctx.sessionProjections.register<'sessionListMetadata', SessionListMetadata>({
      key: 'sessionListMetadata',
      stateSchema: sessionListMetadataSchema,
      init: () => ({ blank: true, lastPromptAt: null }),
      apply: applySessionListMetadata,
      wire: { viewSchema: sessionListMetadataSchema, view: state => state },
      stateVersion: 1,
    })
    ctx.inject(['attachments'], (attachmentCtx) => {
      ctx.sessionProjections.register<'imageLimits', null>({
        key: 'imageLimits',
        stateSchema: z.null(),
        init: () => null,
        apply: state => state,
        wire: {
          viewSchema: imageLimitsSchema,
          view: () => attachmentCtx.attachments.imageLimits,
        },
        stateVersion: 1,
      })
    })
    ctx.inject(['attachments', 'documentExtract'], (intakeCtx) => {
      const limits = intakeCtx.attachments.fileLimits
      if (limits === undefined) return
      intakeCtx.sessionProjections.register<'fileIntake', null>({
        key: 'fileIntake',
        stateSchema: z.null(),
        init: () => null,
        apply: state => state,
        wire: {
          viewSchema: fileIntakeSchema,
          view: (): FileIntake => {
            const accepted = intakeCtx.documentExtract.accepted()
            return {
              maxFileBytes: limits.maxFileBytes,
              maxFilesPerMessage: limits.maxFilesPerMessage,
              maxMessageFileBytes: limits.maxMessageFileBytes,
              extensions: accepted.extensions,
              mediaTypes: accepted.mediaTypes,
            }
          },
        },
        stateVersion: 1,
      })
    })
  }

  /**
   * Build one current attached-Session summary.
   * @param session - attached Session to summarize.
   * @returns current list metadata and available projections.
   */
  summaryFor(session: Session): SessionSummary {
    const projections = this.projectionsFor({ header: session.header }, session)
    const metadata = projections?.values.sessionListMetadata
    return {
      sessionId: session.id,
      updatedAt: updatedAt(session.header, metadata),
      running: this.ctx.agents.get(session.id)?.status === 'running',
      blank: metadata?.blank ?? session.seq === 0,
      ...listFields(session.header),
      ...(projections === undefined ? {} : { projections }),
    }
  }

  /**
   * Read every visible attached and persisted Session without activating an Agent.
   * @param signal - optional cancellation for persistence reads.
   * @returns visible Session summaries ordered by activity.
   */
  async list(signal?: AbortSignal): Promise<SessionSummary[]> {
    signal?.throwIfAborted()
    const caller = this.ctx.get('identityUsers')?.actingUser()
    const records = await this.ctx.sessionQuery.listSessions(signal)
    signal?.throwIfAborted()
    const items: SessionSummary[] = []
    const cold: ColdListEntry[] = []
    for (const record of records) {
      // Only the caller's own Sessions are visible to them.
      if (!callerMayAccessSession(this.ctx, record.header, caller)) continue
      const live = this.ctx.sessions.get(record.header.id)
      if (live !== undefined) {
        items.push(this.summaryFor(live))
        continue
      }
      // A cold Session with no cwd belongs to a workspace that has no directory,
      // so it lists like any other. Skipping it here is what would make such a
      // Session appear while it is live and then vanish from the sidebar at the
      // next restart.
      cold.push({
        header: record.header,
        ...record.inheritedEventCount === undefined
          ? {}
          : { inheritedEventCount: record.inheritedEventCount },
      })
    }
    for (const entry of cold) items.push(this.summarizeCold(entry))
    await this.recoverMissingTitles(items, cold, signal)
    items.sort((left, right) => right.updatedAt - left.updatedAt)
    return items
  }

  /**
   * Refold the rows whose cache row produced no title, from their durable
   * logs, and replace them in `items`.
   *
   * The cache is a fold shortcut, not the authority: a row that is absent,
   * identity-mismatched, or stamped with a version this build does not accept
   * reads as missing, and serving that as a title-less row shows a session the
   * user already named as one that has no name. The durable `session/title`
   * events still exist in the log, so the value is recoverable and the list
   * recovers it rather than displaying a name the session does not have.
   *
   * This is the exceptional path. A hit costs nothing extra, the work is
   * bounded by {@link COLD_TITLE_REFOLD_LIMIT} sessions per listing, and each
   * refold seeds from the cached watermark and writes the row back, so a
   * recovered session is a cache hit next time. A refold failure leaves the
   * cache-only summary in place.
   * @param items - summaries built so far; repaired rows are replaced in place.
   * @param cold - the cold entries `items` was built from.
   * @param signal - cancellation for the persistence reads.
   */
  private async recoverMissingTitles(
    items: SessionSummary[],
    cold: readonly ColdListEntry[],
    signal?: AbortSignal,
  ): Promise<void> {
    const cache = this.ctx.get('sessionProjectionCache')
    const persistence = this.ctx.get('sessionPersistence')
    if (cache === undefined || persistence === undefined) return
    const byId = new Map(cold.map(entry => [entry.header.id, entry]))
    const missing = items.filter(item =>
      byId.has(item.sessionId)
      && !item.blank
      && item.projections?.values.title === undefined)
    for (const item of missing.slice(0, COLD_TITLE_REFOLD_LIMIT)) {
      signal?.throwIfAborted()
      const entry = byId.get(item.sessionId)
      /* v8 ignore next -- every `missing` row was selected through `byId`. */
      if (entry === undefined) continue
      const inherited = entry.inheritedEventCount ?? SessionLogOffset(0)
      let snapshot: ProjectionSnapshot
      try {
        const suffix = await persistence.readFrom(item.sessionId, SessionLogOffset(0), signal)
        snapshot = cache.coldSnapshot(entry.header, inherited, suffix.events)
      } catch (error: unknown) {
        signal?.throwIfAborted()
        this.ctx.logger.warn(
          `api-session.list: title refold for "${item.sessionId}" failed; serving the cached row: ${String(error)}`,
        )
        continue
      }
      const index = items.indexOf(item)
      items[index] = {
        ...item,
        projections: {
          asOfSeq: snapshot.asOfSeq,
          values: snapshot.values as SessionProjectionValues,
        },
      }
    }
  }

  private summarizeCold(entry: ColdListEntry): SessionSummary {
    const { header } = entry
    // Cache-first: a title is served from the durable projection cache, so a
    // hit keeps listing latency independent of log size. Only a miss reaches
    // `recoverMissingTitles`, which refolds that session from its log.
    //
    // No live lookup here: `list` scans the live Session registry and builds
    // these in one synchronous pass, so a Session attached after the listing
    // read is already served by `summaryFor` and never reaches this summary.
    const projections = this.projectionsFor(entry)
    const metadata = projections?.values.sessionListMetadata
    return {
      sessionId: header.id,
      updatedAt: updatedAt(header, metadata),
      running: false,
      // A cache miss stays visible; the renderer keeps the localized New
      // Session label on a title-less row rather than ever showing the Session id.
      blank: metadata?.blank ?? false,
      ...listFields(header),
      ...(projections === undefined ? {} : { projections }),
    }
  }

  /**
   * Search current visible message content without activating any matching Session.
   * @param query - literal message-content query.
   * @param signal - cancellation for list and search reads.
   * @returns authorized bounded Session search results.
   */
  async search(query: string, signal: AbortSignal): Promise<SessionSearchValue> {
    const normalizedQuery = normalizeSearchQuery(query)
    signal.throwIfAborted()
    const provider = this.ctx.get('sessionQuery')
    if (provider === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'session search is unavailable: this deployment does not mount @aeven/session-query',
        {},
      )
    }
    const caller = this.ctx.get('identityUsers')?.actingUser()
    try {
      const visible = (await provider.listSessions(signal)).filter(record => callerMayAccessSession(this.ctx, record.header, caller))
      signal.throwIfAborted()
      const visibleIds = new Set(visible.map(record => record.header.id))
      if (visibleIds.size === 0) return { items: [], hasMore: false }
      const authorized: SessionSearchItem[] = []
      const acceptedIds = new Set<SessionId>()
      const seenCursors = new Set<SessionSearchCursor>()
      let cursor: SessionSearchCursor | undefined
      let providerCalls = 0
      // One extra hit answers `hasMore` without a second provider search.
      let pageLimit = SESSION_SEARCH_RESULT_LIMIT + 1
      while (authorized.length <= SESSION_SEARCH_RESULT_LIMIT) {
        signal.throwIfAborted()
        if (providerCalls >= SEARCH_PROVIDER_CALL_LIMIT) {
          throw new Error(`session search provider exceeded the ${SEARCH_PROVIDER_CALL_LIMIT}-call work budget`)
        }
        providerCalls++
        const requestedCursor = cursor
        const requestedLimit = pageLimit
        let page
        try {
          page = await provider.searchSessions({
            query: normalizedQuery,
            eventFilters: [
              { kind: 'type', values: ['user/message', 'assistant/message'] },
              { kind: 'surface', values: ['current'] },
            ],
            limit: requestedLimit,
            ...(requestedCursor === undefined ? {} : { cursor: requestedCursor }),
          }, { signal })
          signal.throwIfAborted()
        } catch (error: unknown) {
          signal.throwIfAborted()
          if (requestedCursor === undefined
            && error instanceof SessionQueryError
            && error.code === 'SESSION_QUERY_INVALID_LIMIT'
            && requestedLimit > 1) {
            pageLimit = Math.max(1, Math.floor(requestedLimit / 2))
            continue
          }
          if (requestedCursor !== undefined
            && error instanceof SessionQueryError
            && error.code === 'SESSION_QUERY_STALE_CURSOR') {
            authorized.length = 0
            acceptedIds.clear()
            seenCursors.clear()
            cursor = undefined
            continue
          }
          throw error
        }
        if (page.items.length > requestedLimit) {
          throw new Error(`session search provider returned ${String(page.items.length)} items; maximum is ${String(requestedLimit)}`)
        }
        for (const hit of page.items) {
          if (authorized.length > SESSION_SEARCH_RESULT_LIMIT) continue
          if (!visibleIds.has(hit.header.id)
            || hit.bestMatch.sessionId !== hit.header.id
            || hit.bestMatch.surface !== 'current'
            || !MESSAGE_TYPES.has(hit.bestMatch.type)
            || acceptedIds.has(hit.header.id)) continue
          acceptedIds.add(hit.header.id)
          authorized.push({
            sessionId: hit.header.id,
            seq: hit.bestMatch.seq,
            snippet: truncateUnicodeCodePoints(hit.bestMatch.snippet, SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS),
          })
        }
        if (page.nextCursor !== undefined) {
          if (seenCursors.has(page.nextCursor)) {
            throw new Error('session search provider repeated a continuation cursor')
          }
          seenCursors.add(page.nextCursor)
        }
        if (authorized.length > SESSION_SEARCH_RESULT_LIMIT || page.nextCursor === undefined) break
        cursor = page.nextCursor
      }
      return {
        items: authorized.slice(0, SESSION_SEARCH_RESULT_LIMIT),
        hasMore: authorized.length > SESSION_SEARCH_RESULT_LIMIT,
      }
    } catch (error: unknown) {
      signal.throwIfAborted()
      if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_ABORTED') {
        throw new RemoteError('gateway/cancelled', 'session search was aborted', {})
      }
      if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SEARCH_DISABLED') {
        throw new RemoteError('session/search-disabled', 'session content search is disabled', {})
      }
      throw new RemoteError('gateway/internal', `session search failed: ${String(error)}`, {})
    }
  }

  private projectionsFor(
    entry: ColdListEntry,
    session?: Session,
  ): SessionProjectionHints | undefined {
    const { header } = entry
    try {
      // A seeded (fork) Session's cache row is keyed by its inherited cut, which
      // a header cannot express. The listing therefore carries the cut from the
      // record; looking the row up without it made every fork child's title
      // unreachable even though the cache held one.
      const block = session === undefined
        ? this.ctx.get('sessionProjectionCache')?.cachedSnapshot(
          header,
          entry.inheritedEventCount ?? SessionLogOffset(0),
        )
        : this.ctx.sessionProjections.cachedSnapshot(session)
      return block !== undefined && Object.keys(block.values).length > 0
        ? {
          asOfSeq: block.asOfSeq,
          // Listing hints contain every currently cached wire value but remain
          // partial: missing cells and cache rows are never materialized here.
          values: block.values as SessionProjectionValues,
        }
        : undefined
    } catch (error) {
      this.ctx.logger.warn(
        `api-session.list: projection column for "${header.id}" failed; serving the row without it: ${String(error)}`,
      )
      return undefined
    }
  }
}

function normalizeSearchQuery(query: string): string {
  const normalized = query.trim()
  if (normalized.length === 0) {
    throw new RemoteError('gateway/bad-request', 'session search query must not be empty', {})
  }
  if (normalized.length > SESSION_SEARCH_QUERY_MAX_CHARS) {
    throw new RemoteError(
      'gateway/bad-request',
      `session search query must contain at most ${SESSION_SEARCH_QUERY_MAX_CHARS} UTF-16 code units`,
      {},
    )
  }
  if (normalized.includes('\0')) {
    throw new RemoteError('gateway/bad-request', 'session search query must not contain NUL', {})
  }
  return normalized
}

function updatedAt(header: SessionHeader, metadata: SessionListMetadata | undefined): number {
  return Math.max(header.createdAt, metadata?.lastPromptAt ?? 0)
}

function listFields(header: SessionHeader): {
  readonly createdAt: number
  readonly parentSessionId?: SessionId
  readonly origin?: 'subagent'
  readonly cwd?: string
} {
  return {
    createdAt: header.createdAt,
    ...(header.parentSession === undefined ? {} : { parentSessionId: header.parentSession }),
    ...(header.origin === undefined ? {} : { origin: header.origin }),
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
  }
}
